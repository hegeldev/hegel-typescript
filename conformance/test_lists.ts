/**
 * Conformance binary for list generation.
 *
 * Params (JSON from argv[1]):
 *   { min_size?: number, max_size?: number|null,
 *     min_value?: number|null, max_value?: number|null,
 *     mode?: "basic"|"non_basic" }
 * Metrics: { size: number, min_element: number|null, max_element: number|null }
 */

import { getTestCases, makeNonBasic, writeMetrics } from "./helpers.js";
import * as gs from "../src/generators/index.js";
import * as hegel from "../src/runner.js";

const params: Record<string, unknown> = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const mode = (params["mode"] as string | undefined) ?? "basic";

const minSize = params["min_size"] != null ? Number(params["min_size"]) : 0;
const maxSize = params["max_size"] != null ? Number(params["max_size"]) : undefined;
const minValue = params["min_value"] != null ? Number(params["min_value"]) : undefined;
const maxValue = params["max_value"] != null ? Number(params["max_value"]) : undefined;

const testCases = getTestCases();

// Force non-basic (collection protocol) when mode is "non_basic" or when the
// HEGEL_PROTOCOL_TEST_MODE requires the collection protocol.
const testMode = process.env["HEGEL_PROTOCOL_TEST_MODE"] ?? "";
const needsNonBasic = mode === "non_basic" || testMode.includes("collection");
const baseElemGen = gs.integers({ minValue, maxValue });
const elemGen = needsNonBasic ? makeNonBasic(baseElemGen) : baseElemGen;
const gen = gs.arrays(elemGen, { minSize, maxSize });

hegel.test(
  function conformance_lists(tc) {
    const items = tc.draw(gen);
    const size = items.length;
    writeMetrics({
      size,
      min_element: size > 0 ? Math.min(...items) : null,
      max_element: size > 0 ? Math.max(...items) : null,
    });
  },
  { testCases },
)();

process.exit(0);
