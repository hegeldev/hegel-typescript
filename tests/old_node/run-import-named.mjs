// Verify that namespace imports from the built bundle resolve.
import assert from "node:assert/strict";
import * as hegel from "hegel";
import * as gs from "hegel/generators";

for (const [name, value] of [
  ["hegel.test", hegel.test],
  ["hegel.Hegel", hegel.Hegel],
  ["gs.Generator", gs.Generator],
  ["gs.BasicGenerator", gs.BasicGenerator],
  ["gs.integers", gs.integers],
  ["gs.floats", gs.floats],
  ["gs.booleans", gs.booleans],
  ["gs.text", gs.text],
  ["gs.binary", gs.binary],
  ["gs.just", gs.just],
  ["gs.sampledFrom", gs.sampledFrom],
  ["gs.arrays", gs.arrays],
  ["gs.sets", gs.sets],
  ["gs.maps", gs.maps],
  ["gs.oneOf", gs.oneOf],
  ["gs.optional", gs.optional],
  ["gs.tuples", gs.tuples],
  ["gs.record", gs.record],
  ["gs.composite", gs.composite],
  ["gs.fromRegex", gs.fromRegex],
  ["gs.emails", gs.emails],
]) {
  assert.equal(typeof value, "function", `expected ${name} to be a function`);
}
