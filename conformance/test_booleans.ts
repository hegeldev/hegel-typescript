/**
 * Conformance binary for boolean generation.
 *
 * Params (JSON from argv[1]): {} (no parameters)
 * Metrics: { value: boolean }
 */

import { getTestCases, writeMetrics, booleans, draw, runHegelTest } from "hegel";

const testCases = getTestCases();
const gen = booleans();

await runHegelTest(
  async function conformance_booleans() {
    const value = await draw(gen);
    writeMetrics({ value });
  },
  { testCases },
);

process.exit(0);
