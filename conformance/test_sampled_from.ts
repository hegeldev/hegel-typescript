/**
 * Conformance binary for sampledFrom generation.
 *
 * Params (JSON from argv[1]): { options: number[] }
 * Metrics: { value: number }
 */

import { getTestCases, writeMetrics } from "../src/conformance.js";
import { sampledFrom } from "../src/generators.js";
import { draw } from "../src/runner.js";
import { runHegelTest } from "../src/session.js";

const params: Record<string, unknown> = process.argv[2] ? JSON.parse(process.argv[2]) : {};

const options = (params["options"] as number[]) ?? [0];

const testCases = getTestCases();
const gen = sampledFrom(options);

await runHegelTest(
  async function conformance_sampled_from() {
    const value = await draw(gen);
    writeMetrics({ value });
  },
  { testCases },
);

process.exit(0);
