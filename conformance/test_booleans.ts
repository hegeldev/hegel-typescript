/**
 * Conformance binary for boolean generation.
 *
 * Params (JSON from argv[1]): {} (no parameters)
 * Metrics: { value: boolean }
 */

import { getTestCases, writeMetrics } from "./helpers.js";
import { booleans } from "../src/generators/index.js";
import { hegel } from "../src/runner.js";

const testCases = getTestCases();
const gen = booleans();

hegel(
  function conformance_booleans(tc) {
    const value = tc.draw(gen);
    writeMetrics({ value });
  },
  { testCases },
)();

process.exit(0);
