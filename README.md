# worker-cdn-s3

Cloudflare Worker that fronts a private S3-compatible bucket as a CDN. Edge-signed public prefix cached at Cloudflare,
transparent passthrough for app-issued presigned URLs. Works with any SigV4-compatible provider.

## How it works

- **Public prefix** (set via `PUBLIC_PATH_PREFIX`): Worker holds a read-only key, signs `GET` at the edge, response
  cached at Cloudflare.
- **Everything else**: passthrough. App server authorizes per-user, presigns against the upstream bucket, Worker
  forwards as-is. The bucket validates the signature.

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

Set the bucket's default `Cache-Control` header so Cloudflare caches consistently:

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
because the toml declares none.

## Verification

```bash
# Direct upstream blocked (bucket is private):
curl -I https://<STORAGE_HOSTNAME>/public/avatars/<id>          # 403

# CDN public path (cached after first MISS):
curl -I https://cdn.example.com/public/avatars/<id>             # 200

# CDN private path (presigned by app):
curl -I "https://cdn.example.com/<key>?X-Amz-Signature=..."     # 200; 403 if tampered
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
```
