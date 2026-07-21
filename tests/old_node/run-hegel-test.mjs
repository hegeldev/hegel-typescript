// tests run by our CI job for older node versions. Separated out because vitest doesn't
// support older node versions.

import assert from "node:assert/strict";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

// 1. A passing property.
hegel.test(
  (tc) => {
    const x = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
    assert.ok(x >= 0 && x <= 100, `expected 0..100, got ${x}`);
    const b = tc.draw(gs.booleans());
    assert.equal(typeof b, "boolean");
    const s = tc.draw(gs.text({ maxSize: 10 }));
    assert.equal(typeof s, "string");
  },
  { testCases: 25 },
);

// 2. A failing property.
let caught = null;
try {
  hegel.test(
    (tc) => {
      const arr = tc.draw(gs.arrays(gs.integers({ minValue: 0, maxValue: 100 }), { maxSize: 10 }));
      if (arr.some((x) => x > 50)) {
        throw new Error("found big number");
      }
    },
    { testCases: 200 },
  );
} catch (e) {
  caught = e;
}
assert.ok(caught, "expected property to fail");
assert.match(
  caught.message,
  /found big number/,
  `expected 'found big number' in error message, got: ${caught.message}`,
);

// 3. assume().
hegel.test(
  (tc) => {
    const x = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
    tc.assume(x > 50);
    assert.ok(x > 50);
  },
  { testCases: 25 },
);
