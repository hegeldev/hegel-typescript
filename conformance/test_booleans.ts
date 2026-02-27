/**
 * Conformance binary for boolean generation.
 *
 * Params (JSON from argv[1]): {} (no parameters)
 * Metrics: { value: boolean }
 */

import { getTestCases, writeMetrics } from "../src/conformance.js";
import { booleans } from "../src/generators.js";
import { runHegelTest } from "../src/session.js";

const testCases = getTestCases();
const gen = booleans();

await runHegelTest(
  async function conformance_booleans() {
    const value = await gen.generate();
    writeMetrics({ value });
  },
  { testCases },
);

process.exit(0);
