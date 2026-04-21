/**
 * Conformance binary for float generation.
 *
 * Params (JSON from argv[1]):
 *   { min_value?: number|null, max_value?: number|null,
 *     allow_nan?: boolean|null, allow_infinity?: boolean|null,
 *     exclude_min?: boolean, exclude_max?: boolean }
 * Metrics: { value: number|null, is_nan: boolean, is_infinite: boolean }
 */

import { getTestCases, writeMetrics } from "./helpers.js";
import * as gs from "../src/generators/index.js";
import * as hegel from "../src/runner.js";

const params: Record<string, unknown> = process.argv[2] ? JSON.parse(process.argv[2]) : {};

const minValue = params["min_value"] != null ? Number(params["min_value"]) : undefined;
const maxValue = params["max_value"] != null ? Number(params["max_value"]) : undefined;
const allowNan = params["allow_nan"] != null ? Boolean(params["allow_nan"]) : undefined;
const allowInfinity =
  params["allow_infinity"] != null ? Boolean(params["allow_infinity"]) : undefined;
// Only apply exclude_min/exclude_max when there is an actual bound —
// the server rejects exclude_min=true when min_value is None.
const excludeMin = minValue !== undefined ? Boolean(params["exclude_min"]) : undefined;
const excludeMax = maxValue !== undefined ? Boolean(params["exclude_max"]) : undefined;

const testCases = getTestCases();
const gen = gs.floats({ minValue, maxValue, allowNan, allowInfinity, excludeMin, excludeMax });

hegel.test(
  function conformance_floats(tc) {
    const value = tc.draw(gen);
    const isNan = Number.isNaN(value);
    const isInfinite = !isNan && !Number.isFinite(value);
    writeMetrics({
      value: isNan || isInfinite ? null : value,
      is_nan: isNan,
      is_infinite: isInfinite,
    });
  },
  { testCases },
)();

process.exit(0);
