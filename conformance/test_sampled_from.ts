/**
 * Conformance binary for sampledFrom generation.
 *
 * Params (JSON from argv[1]): { options: number[] }
 * Metrics: { value: number }
 */

import { getTestCases, writeMetrics } from "./helpers.js";
import * as gs from "../src/generators/index.js";
import * as hegel from "../src/runner.js";

const params: Record<string, unknown> = process.argv[2] ? JSON.parse(process.argv[2]) : {};

const options = (params["options"] as number[]) ?? [0];

const testCases = getTestCases();
const gen = gs.sampledFrom(options);

hegel.test(
  function conformance_sampled_from(tc) {
    const value = tc.draw(gen);
    writeMetrics({ value });
  },
  { testCases },
)();

process.exit(0);
