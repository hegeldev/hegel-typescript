/**
 * Conformance binary for text (string) generation.
 *
 * Params (JSON from argv[1]): { min_size?: number, max_size?: number|null }
 * Metrics: { length: number }  (Unicode codepoint count)
 */

import { getTestCases, writeMetrics, text, draw, runHegelTest } from "hegel";

const params: Record<string, unknown> = process.argv[2] ? JSON.parse(process.argv[2]) : {};

const minSize = params["min_size"] != null ? Number(params["min_size"]) : 0;
const maxSize = params["max_size"] != null ? Number(params["max_size"]) : null;

const testCases = getTestCases();
const gen = text(minSize, maxSize);

await runHegelTest(
  async function conformance_text() {
    const value = await draw(gen);
    // Count Unicode codepoints (not UTF-16 code units)
    const length = [...value].length;
    writeMetrics({ length });
  },
  { testCases },
);

process.exit(0);
