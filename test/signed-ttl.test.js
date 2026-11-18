import assert from "node:assert/strict"
import { test } from "node:test"
import { signedTtl } from "../src/signed-ttl.js"

const params = (query) => new URL(`https://cdn.example.com/a.jpg?${query}`).searchParams
const at = (iso) => Date.parse(iso)

test("returns the seconds left until the signature expires", () => {
  assert.equal(signedTtl(params("X-Amz-Date=20261118T140000Z&X-Amz-Expires=7200"), at("2026-11-18T14:50:00Z")), 4200)
})

test("returns 0 once the signature has expired", () => {
  assert.equal(signedTtl(params("X-Amz-Date=20261118T140000Z&X-Amz-Expires=7200"), at("2026-11-18T16:00:01Z")), 0)
})

test("returns 0 for unsigned or malformed URLs", () => {
  const now = at("2026-11-18T14:00:00Z")
  assert.equal(signedTtl(params(""), now), 0)
  assert.equal(signedTtl(params("X-Amz-Date=20261118T140000Z"), now), 0)
  assert.equal(signedTtl(params("X-Amz-Date=2026-11-18&X-Amz-Expires=7200"), now), 0)
  assert.equal(signedTtl(params("X-Amz-Date=20261118T140000Z&X-Amz-Expires=abc"), now), 0)
  assert.equal(signedTtl(params("X-Amz-Date=20261118T140000Z&X-Amz-Expires=-5"), now), 0)
})
