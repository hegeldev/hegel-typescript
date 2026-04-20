/**
 * Conformance testing helpers.
 *
 * Utilities used by the conformance binary scripts in this directory to read
 * test configuration from environment variables and write per-test-case
 * metrics to the conformance metrics file. Not part of the public library
 * API — these live alongside the conformance binaries that consume them.
 */

import * as fs from "node:fs";
import type { Generator } from "../src/generators/index.js";

function alwaysTrue(): boolean {
  return true;
}

/**
 * Wrap a generator so it loses its schema, forcing the compositional
 * fallback path. Used by conformance binaries when `mode` is `"non_basic"`.
 */
export function makeNonBasic<T>(gen: Generator<T>): Generator<T> {
  return gen.filter(alwaysTrue);
}

/**
 * Return the number of conformance test cases to run.
 *
 * Reads `CONFORMANCE_TEST_CASES` from the environment. Defaults to 50 if
 * the variable is absent, empty, non-numeric, or non-positive.
 */
export function getTestCases(): number {
  const val = process.env["CONFORMANCE_TEST_CASES"];
  if (!val) return 50;
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return n;
}

/**
 * Append a JSON metrics line to the conformance metrics file.
 *
 * The metrics file path is read from the `CONFORMANCE_METRICS_FILE`
 * environment variable. Throws if the variable is not set or the file
 * cannot be written.
 */
export function writeMetrics(metrics: Record<string, unknown>): void {
  const path = process.env["CONFORMANCE_METRICS_FILE"];
  if (!path) {
    throw new Error("hegel: CONFORMANCE_METRICS_FILE env var not set");
  }
  // JSON.stringify does not escape U+0085 (NEL), U+2028 (LINE SEPARATOR),
  // or U+2029 (PARAGRAPH SEPARATOR). Python's str.splitlines() splits on
  // all three, breaking JSONL parsing. Escape them explicitly.
  const json = JSON.stringify(metrics)
    .replace(/\u0085/g, "\\u0085")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const line = json + "\n";
  fs.appendFileSync(path, line, "utf8");
}
