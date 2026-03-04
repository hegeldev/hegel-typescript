/**
 * Conformance binary for sampledFrom generation.
 *
 * Params (JSON from argv[1]): { options: number[] }
 * Metrics: { value: number }
 */

import { getTestCases, writeMetrics, sampledFrom, draw, runHegelTest } from "hegel";

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
