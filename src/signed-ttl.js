const AMZ_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/

// Seconds a presigned URL stays valid from `nowMs`, or 0 when unsigned, malformed, or expired.
export function signedTtl(searchParams, nowMs) {
  const date = AMZ_DATE.exec(searchParams.get("X-Amz-Date") ?? "")
  const expires = Number(searchParams.get("X-Amz-Expires"))
  if (!date || !Number.isInteger(expires) || expires <= 0) {
    return 0
  }
  const [, y, mo, d, h, mi, s] = date.map(Number)
  const expiresAtMs = Date.UTC(y, mo - 1, d, h, mi, s) + expires * 1000
  return Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000))
}
