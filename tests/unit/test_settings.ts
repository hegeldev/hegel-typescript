import { test } from "node:test"
import assert from "node:assert"
import { hegel, integers } from "../../src/index.js"

test("default runs 100 test cases", async () => {
  let count = 0
  await hegel(() => {
    integers().generate()
    count++
  })
  assert.strictEqual(count, 100)
})
