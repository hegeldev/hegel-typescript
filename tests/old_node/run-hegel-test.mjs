// tests run by our CI job for older node versions. Separated out because vitest doesn't
// support older node versions.

import assert from "node:assert/strict";
import { Hegel, integers, arrays, booleans, text } from "hegel";

// 1. A passing property exercises draw + mark_complete on the happy path.
new Hegel((tc) => {
  const x = tc.draw(integers({ minValue: 0, maxValue: 100 }));
  assert.ok(x >= 0 && x <= 100, `expected 0..100, got ${x}`);
  const b = tc.draw(booleans());
  assert.equal(typeof b, "boolean");
  const s = tc.draw(text({ maxSize: 10 }));
  assert.equal(typeof s, "string");
})
  .settings({ testCases: 25 })
  .run();

// 2. A failing property exercises shrinking + final-replay reporting.
let caught = null;
try {
  new Hegel((tc) => {
    const arr = tc.draw(arrays(integers({ minValue: 0, maxValue: 100 }), { maxSize: 10 }));
    if (arr.some((x) => x > 50)) {
      throw new Error("found big number");
    }
  })
    .settings({ testCases: 200 })
    .run();
} catch (e) {
  caught = e;
}
assert.ok(caught, "expected property to fail");
assert.match(
  caught.message,
  /Property test failed/,
  `expected 'Property test failed' in error message, got: ${caught.message}`,
);

// 3. assume() exercises the INVALID mark_complete path.
new Hegel((tc) => {
  const x = tc.draw(integers({ minValue: 0, maxValue: 100 }));
  tc.assume(x > 50);
  assert.ok(x > 50);
})
  .settings({ testCases: 25 })
  .run();
