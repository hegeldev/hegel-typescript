/**
 * Conformance binary for float generation.
 *
 * Params (JSON from argv[1]):
 *   { min_value?: number|null, max_value?: number|null,
 *     allow_nan?: boolean|null, allow_infinity?: boolean|null,
 *     exclude_min?: boolean, exclude_max?: boolean }
 * Metrics: { value: number|null, is_nan: boolean, is_infinite: boolean }
 */

import { getTestCases, writeMetrics } from "../src/conformance.js";
import { floats } from "../src/generators/index.js";
import { draw } from "../src/runner.js";
import { runHegelTest } from "../src/session.js";

const params: Record<string, unknown> = process.argv[2] ? JSON.parse(process.argv[2]) : {};

const minValue = params["min_value"] != null ? Number(params["min_value"]) : null;
const maxValue = params["max_value"] != null ? Number(params["max_value"]) : null;
const allowNan = params["allow_nan"] != null ? Boolean(params["allow_nan"]) : null;
const allowInfinity = params["allow_infinity"] != null ? Boolean(params["allow_infinity"]) : null;
// Only apply exclude_min/exclude_max when there is an actual bound —
// the server rejects exclude_min=true when min_value is None.
const excludeMin = minValue !== null && Boolean(params["exclude_min"]);
const excludeMax = maxValue !== null && Boolean(params["exclude_max"]);

const testCases = getTestCases();
const gen = floats(minValue, maxValue, allowNan, allowInfinity, excludeMin, excludeMax);

await runHegelTest(
  async function conformance_floats() {
    const value = await draw(gen);
    const isNan = Number.isNaN(value);
    const isInfinite = !isNan && !Number.isFinite(value);
    writeMetrics({
      value: isNan || isInfinite ? null : value,
      is_nan: isNan,
      is_infinite: isInfinite,
    });
  },
  { testCases },
);

process.exit(0);
