/**
 * Conformance binary for integer generation.
 *
 * Params (JSON from argv[1]): { min_value?: number|null, max_value?: number|null }
 * Metrics: { value: number }
 */

import { getTestCases, writeMetrics } from "../src/conformance.js";
import { integers } from "../src/generators/index.js";
import { draw } from "../src/runner.js";
import { runHegelTest } from "../src/session.js";

const params: Record<string, unknown> = process.argv[2] ? JSON.parse(process.argv[2]) : {};

const minValue = params["min_value"] != null ? Number(params["min_value"]) : null;
const maxValue = params["max_value"] != null ? Number(params["max_value"]) : null;

const testCases = getTestCases();
const gen = integers(minValue, maxValue);

await runHegelTest(
  async function conformance_integers() {
    const value = await draw(gen);
    writeMetrics({ value });
  },
  { testCases },
);

process.exit(0);
