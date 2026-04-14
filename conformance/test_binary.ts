/**
 * Conformance binary for binary (byte string) generation.
 *
 * Params (JSON from argv[1]): { min_size?: number, max_size?: number|null }
 * Metrics: { length: number }  (byte count)
 */

import { getTestCases, writeMetrics } from "../src/conformance.js";
import { binary } from "../src/generators.js";
import { hegel } from "../src/runner.js";

const params: Record<string, unknown> = process.argv[2] ? JSON.parse(process.argv[2]) : {};

const minSize = params["min_size"] != null ? Number(params["min_size"]) : 0;
const maxSize = params["max_size"] != null ? Number(params["max_size"]) : undefined;

const testCases = getTestCases();
const gen = binary({ minSize, maxSize });

hegel(
  function conformance_binary(tc) {
    const value = tc.draw(gen);
    writeMetrics({ length: value.length });
  },
  { testCases },
)();

process.exit(0);
