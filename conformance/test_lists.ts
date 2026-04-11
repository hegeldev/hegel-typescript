/**
 * Conformance binary for list generation.
 *
 * Params (JSON from argv[1]):
 *   { min_size?: number, max_size?: number|null,
 *     min_value?: number|null, max_value?: number|null }
 * Metrics: { size: number, min_element: number|null, max_element: number|null }
 *
 * Uses CompositeListGenerator (via .filter) so the collection protocol is
 * exercised — this is required for stop_test_on_collection_more and
 * stop_test_on_new_collection conformance tests to work correctly.
 */

import { getTestCases, makeNonBasic, writeMetrics } from "../src/conformance.js";
import { integers, lists } from "../src/generators/index.js";
import { draw } from "../src/runner.js";
import { runHegelTest } from "../src/session.js";

const params: Record<string, unknown> = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const mode = (params["mode"] as string | undefined) ?? "basic";

const minSize = params["min_size"] != null ? Number(params["min_size"]) : 0;
const maxSize = params["max_size"] != null ? Number(params["max_size"]) : null;
const minValue = params["min_value"] != null ? Number(params["min_value"]) : null;
const maxValue = params["max_value"] != null ? Number(params["max_value"]) : null;

const testCases = getTestCases();
// Force non-basic (collection protocol) when mode is "non_basic" or when the
// HEGEL_PROTOCOL_TEST_MODE requires the collection protocol (stop_test_on_collection_more
// and stop_test_on_new_collection).
const testMode = process.env["HEGEL_PROTOCOL_TEST_MODE"] ?? "";
const needsNonBasic = mode === "non_basic" || testMode.includes("collection");
const baseElemGen = integers(minValue, maxValue);
const elemGen = needsNonBasic ? makeNonBasic(baseElemGen) : baseElemGen;
const gen = lists(elemGen, minSize, maxSize);

await runHegelTest(
  async function conformance_lists() {
    const items = await draw(gen);
    const size = items.length;
    writeMetrics({
      size,
      min_element: size > 0 ? Math.min(...items) : null,
      max_element: size > 0 ? Math.max(...items) : null,
    });
  },
  { testCases },
);

process.exit(0);
