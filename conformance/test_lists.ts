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

import { getTestCases, writeMetrics } from "../src/conformance.js";
import { integers, arrays } from "../src/generators/index.js";
import { hegel } from "../src/runner.js";

const params: Record<string, unknown> = process.argv[2] ? JSON.parse(process.argv[2]) : {};

const minSize = params["min_size"] != null ? Number(params["min_size"]) : 0;
const maxSize = params["max_size"] != null ? Number(params["max_size"]) : undefined;
const minValue = params["min_value"] != null ? Number(params["min_value"]) : undefined;
const maxValue = params["max_value"] != null ? Number(params["max_value"]) : undefined;

const testCases = getTestCases();
// Use .filter(() => true) to force composite path (collection protocol),
// which is required for stop_test_on_collection_more/new_collection test modes.
const elemGen = integers({ minValue, maxValue }).filter(() => true);
const gen = arrays(elemGen, { minSize, maxSize });

hegel(
  function conformance_lists(tc) {
    const items = tc.draw(gen);
    const size = items.length;

    let minElement: number | null = null;
    let maxElement: number | null = null;
    if (size > 0) {
      minElement = items[0]!;
      maxElement = items[0]!;
      for (const item of items) {
        if (item < minElement) minElement = item;
        if (item > maxElement) maxElement = item;
      }
    }

    writeMetrics({ size, min_element: minElement, max_element: maxElement });
  },
  { testCases },
)();

process.exit(0);
