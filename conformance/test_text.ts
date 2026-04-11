/**
 * Conformance binary for text (string) generation.
 *
 * Params (JSON from argv[1]):
 *   { min_size, max_size?, codec?, min_codepoint?, max_codepoint?,
 *     categories?, exclude_categories?, include_characters?, exclude_characters? }
 * Metrics: { codepoints: number[] }  (Unicode codepoint values)
 */

import { getTestCases, writeMetrics } from "../src/conformance.js";
import { text, CharacterOptions } from "../src/generators/index.js";
import { draw } from "../src/runner.js";
import { runHegelTest } from "../src/session.js";

const params: Record<string, unknown> = process.argv[2] ? JSON.parse(process.argv[2]) : {};

const minSize = params["min_size"] != null ? Number(params["min_size"]) : 0;
const maxSize = params["max_size"] != null ? Number(params["max_size"]) : null;

const opts: CharacterOptions = {};
if (params["codec"] != null) opts.codec = String(params["codec"]);
if (params["min_codepoint"] != null) opts.minCodepoint = Number(params["min_codepoint"]);
if (params["max_codepoint"] != null) opts.maxCodepoint = Number(params["max_codepoint"]);
if (params["categories"] != null) opts.categories = params["categories"] as string[];
if (params["exclude_categories"] != null)
  opts.excludeCategories = params["exclude_categories"] as string[];
if (params["include_characters"] != null)
  opts.includeCharacters = String(params["include_characters"]);
if (params["exclude_characters"] != null)
  opts.excludeCharacters = String(params["exclude_characters"]);

const testCases = getTestCases();
const gen = text(minSize, maxSize, opts);

await runHegelTest(
  async function conformance_text() {
    const value = await draw(gen);
    // Extract Unicode codepoints (not UTF-16 code units)
    const codepoints: number[] = [];
    for (const ch of value) {
      codepoints.push(ch.codePointAt(0)!);
    }
    writeMetrics({ codepoints });
  },
  { testCases },
);

process.exit(0);
