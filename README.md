# worker-cdn-s3

Cloudflare Worker that fronts a private S3-compatible bucket as a CDN. Edge-signed public prefix cached at Cloudflare,
transparent passthrough for app-issued presigned URLs. Works with any SigV4-compatible provider.

## How it works

- **Public prefix** (set via `PUBLIC_PATH_PREFIX`): Worker holds a read-only key, signs `GET` at the edge, response
  cached at Cloudflare.
- **Everything else**: passthrough. App server authorizes per-user, presigns against the upstream bucket, Worker
  forwards as-is. The bucket validates the signature. Successful responses are cached at the edge (and in the browser)
  only until the signature expires, computed from `X-Amz-Date` + `X-Amz-Expires`, so an expired link never keeps working
  from cache. Revoking access early (deleting the file or the key) does not evict copies already cached; they stay
  reachable until the link expires, so keep presign lifetimes short. Unsigned, expired, and error responses are never
  cached. Apps that reuse the same presigned URL for a while (e.g. signing time rounded to the hour) get shared edge
  hits for free.

`PUBLIC_PATH_PREFIX` modes:

| Value           | Behavior                                                            |
| --------------- | ------------------------------------------------------------------- |
| `<path-prefix>` | `/<path-prefix>/*` edge-signed and cached, rest passthrough         |
| `*`             | every path edge-signed and cached (no passthrough, full public CDN) |
| unset           | no edge signing, every path requires an app-presigned URL           |

No writes, no listing, no bucket config access through this Worker.

## Supported providers

Any S3-compatible storage with SigV4 auth. Common ones:

| Provider              | `STORAGE_HOSTNAME` pattern                 |
| --------------------- | ------------------------------------------ |
| Backblaze B2          | `<bucket>.s3.<region>.backblazeb2.com`     |
| Linode Object Storage | `<bucket>.<region>.linodeobjects.com`      |
| DigitalOcean Spaces   | `<bucket>.<region>.digitaloceanspaces.com` |
| Wasabi                | `<bucket>.s3.<region>.wasabisys.com`       |
| Vultr Object Storage  | `<bucket>.<region>.vultrobjects.com`       |
| AWS S3                | `<bucket>.s3.<region>.amazonaws.com`       |

> If your upstream is Cloudflare R2, see [worker-cdn-r2](https://github.com/gentasumantri/worker-cdn-r2), which uses
> bindings instead of S3 API + SigV4.

## Deployment

### Manual

```bash
git clone git@github.com:gentasumantri/worker-cdn-s3.git
cd worker-cdn-s3
npm install
# Set vars + secrets in CF dashboard (see Configuration), then:
npm run deploy
```

Dashboard vars survive deploys because `wrangler.toml` sets `keep_vars = true`. Vars passed with `--var` or a `[vars]`
block still override them for that deploy.

### Auto via Workers Builds

Connect the GitHub repo in **Worker > Settings > Build > Git integration**. To deploy under a custom name (e.g.
`cdn-dev`), set the **Deploy command**:

```bash
npx wrangler deploy --name cdn-dev
```

Vars and secrets must be set in the dashboard before the first build.

## Configuration

### 1. Bucket prep

Create a read-only application/access key scoped to your bucket. Scope it to the path matching `PUBLIC_PATH_PREFIX`
(e.g. `public/`). For `PUBLIC_PATH_PREFIX=*` scope to the whole bucket. If `PUBLIC_PATH_PREFIX` is unset (all-private
mode), the Worker does not call the bucket directly, so this key can be omitted.

Set the bucket's default `Cache-Control` header so Cloudflare caches the public prefix (without it the edge returns
`BYPASS`). Passthrough responses ignore it and stay capped at the signature expiry:

```
Cache-Control: public, max-age=86400
```

Backblaze B2 example:

```bash
b2 bucket update <bucket> --bucket-info '{"Cache-Control":"public, max-age=86400"}'
```

### 2. Variables and secrets

Set in **Worker > Settings > Variables and Secrets**:

| Type     | Name                        | Value                                                          |
| -------- | --------------------------- | -------------------------------------------------------------- |
| Variable | `STORAGE_ACCESS_KEY_ID`     | access key ID from step 1                                      |
| Variable | `STORAGE_REGION`            | region code (e.g. `us-west-004`, `us-east-1`)                  |
| Variable | `STORAGE_HOSTNAME`          | virtual-hosted bucket hostname (see Supported providers table) |
| Variable | `PUBLIC_PATH_PREFIX`        | optional, see How it works                                     |
| Variable | `PUBLIC_CACHE_TTL`          | edge cache seconds (e.g. `86400`)                              |
| Secret   | `STORAGE_SECRET_ACCESS_KEY` | secret access key from step 1                                  |

`STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_REGION`, and `PUBLIC_CACHE_TTL` are only used when
`PUBLIC_PATH_PREFIX` is set. For all-private mode only `STORAGE_HOSTNAME` matters.

Alternative for local dev or non-public deploys: uncomment the `[vars]` block in `wrangler.toml`. The secret always goes
through `wrangler secret put` or the dashboard. Never in the toml.

### 3. Custom domain

Add via **Worker > Settings > Domains & Routes > Add Custom Domain**. Routes set in the dashboard persist across deploys
because the toml declares none, so do not pass `--domain` on deploy.

### 4. Zone cache settings (required)

In the CDN domain's zone, set **Caching > Configuration > Browser Cache TTL** to **Respect Existing Headers**. Any other
value raises a shorter browser `max-age` up to that TTL, so browsers keep private files after their link expires. The
Worker cannot prevent this; it is applied after the Worker responds. Check it on every zone that serves this Worker.

## App integration

- **Private files**: presign `GET` against the bucket host, then swap the host for the CDN domain (path and query
  unchanged). Keep lifetimes short; a cached copy stays reachable until its link expires, even if the file is deleted.
- **Shared edge cache**: presigned URLs are deterministic. Round the signing time (e.g. to the hour) and make the
  lifetime longer than the rounding window (e.g. 2 hours), so everyone gets the same URL within that window and hits the
  edge cache. Without rounding every URL is unique: still safe, just no shared hits.
- **Public files**: store under `PUBLIC_PATH_PREFIX` and link `https://<cdn>/<prefix>/<key>` directly, no signing. Use
  unique keys (e.g. random names) so replaced files never collide with the one-day edge copy.
- **Uploads** never go through the Worker (`PUT` returns 405). Presign `PUT` against the bucket host and add a bucket
  CORS rule for the app origin.
- **Logs**: with `invocation_logs = true` the Worker logs full request URLs, including signatures. Anyone who can read
  the logs can reuse a link until it expires.

## Verification

```bash
# Direct upstream blocked (bucket is private):
curl -I https://<STORAGE_HOSTNAME>/public/avatars/<id>          # 403

# CDN public path (cached after first MISS):
curl -I https://cdn.example.com/public/avatars/<id>             # 200

# CDN private path (presigned by app):
curl -I "https://cdn.example.com/<key>?X-Amz-Signature=..."     # 200, cached until the signature expires
                                                                 # 403 if tampered, 401 if unsigned or expired
```

## Operations

```bash
npm run dev    # local Worker (reads vars from wrangler.toml [vars])
npm run tail   # tail production logs
```

## Development

```bash
npm install
npm run format    # prettier: auto-format
npm run check     # prettier: check formatting (CI)
npm test          # node:test unit tests
```
