import { AwsClient } from "aws4fetch"

const ALLOWED_METHODS = new Set(["GET", "HEAD"])

function isFilePath(pathname) {
  return pathname.length > 1 && !pathname.endsWith("/")
}

export default {
  async fetch(request, env) {
    if (!ALLOWED_METHODS.has(request.method)) {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      })
    }

    const url = new URL(request.url)
    const upstreamUrl = `https://${env.STORAGE_HOSTNAME}${url.pathname}${url.search}`

    // PUBLIC_PATH_PREFIX selects what gets edge-signed and cached:
    //   "<prefix>" : only /<prefix>/* is public, rest goes to passthrough
    //   "*"        : every path is public (no passthrough)
    //   unset      : nothing is public (every path goes to passthrough)
    const publicPrefix = env.PUBLIC_PATH_PREFIX
    const isPublic = publicPrefix === "*" || (publicPrefix && url.pathname.startsWith(`/${publicPrefix}/`))

    if (isPublic) {
      if (!isFilePath(url.pathname)) {
        return new Response("Not Found", { status: 404 })
      }
      return servePublic(upstreamUrl, env)
    }

    // fetch() auto-rewrites Host to env.STORAGE_HOSTNAME so SigV4 signatures verify.
    const passthrough = await fetch(upstreamUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    })
    return withSecurityHeaders(passthrough)
  },
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers)
  headers.set("X-Content-Type-Options", "nosniff")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function servePublic(upstreamUrl, env) {
  const aws = new AwsClient({
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    service: "s3",
    region: env.STORAGE_REGION,
  })
  const signed = await aws.sign(upstreamUrl, { method: "GET" })

  const ttl = Number(env.PUBLIC_CACHE_TTL ?? 86400)
  const response = await fetch(signed, {
    cf: { cacheTtl: ttl, cacheEverything: true },
  })

  // Force consistent edge caching regardless of upstream Cache-Control.
  const headers = new Headers(response.headers)
  headers.set("Cache-Control", `public, max-age=${ttl}, immutable`)
  headers.set("X-Content-Type-Options", "nosniff")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
