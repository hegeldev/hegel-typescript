/**
 * Conformance binary for boolean generation.
 *
 * Params (JSON from argv[1]): {} (no parameters)
 * Metrics: { value: boolean }
 */

import { getTestCases, makeNonBasic, writeMetrics } from "../src/conformance.js";
import { booleans } from "../src/generators/index.js";
import { draw } from "../src/runner.js";
import { runHegelTest } from "../src/session.js";

const params: Record<string, unknown> = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const mode = (params["mode"] as string | undefined) ?? "basic";

const testCases = getTestCases();
const baseGen = booleans();
const gen = mode === "non_basic" ? makeNonBasic(baseGen) : baseGen;

await runHegelTest(
  async function conformance_booleans() {
    const value = await draw(gen);
    writeMetrics({ value });
  },
  { testCases },
);

process.exit(0);
