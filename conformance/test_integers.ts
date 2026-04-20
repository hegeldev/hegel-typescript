/**
 * Conformance binary for integer generation.
 *
 * Params (JSON from argv[1]): { min_value?: number|null, max_value?: number|null }
 * Metrics: { value: number }
 */

import { getTestCases, writeMetrics } from "./helpers.js";
import { integers } from "../src/generators/index.js";
import { hegel } from "../src/runner.js";

const params: Record<string, unknown> = process.argv[2] ? JSON.parse(process.argv[2]) : {};

const minValue = params["min_value"] != null ? Number(params["min_value"]) : undefined;
const maxValue = params["max_value"] != null ? Number(params["max_value"]) : undefined;

const testCases = getTestCases();
const gen = integers({ minValue, maxValue });

hegel(
  function conformance_integers(tc) {
    const value = tc.draw(gen);
    writeMetrics({ value });
  },
  { testCases },
)();

process.exit(0);
