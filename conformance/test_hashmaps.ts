/**
 * Conformance binary for dict (hashmap) generation.
 *
 * Params (JSON from argv[1]):
 *   { min_size?: number, max_size?: number,
 *     key_type?: "string"|"integer",
 *     min_key?: number, max_key?: number,
 *     min_value?: number, max_value?: number }
 * Metrics:
 *   { size: number, min_key: ...|null, max_key: ...|null,
 *     min_value: number|null, max_value: number|null }
 */

import { getTestCases, writeMetrics } from "../src/conformance.js";
import { maps, integers, text } from "../src/generators/index.js";
import { hegel } from "../src/runner.js";

const params: Record<string, unknown> = process.argv[2] ? JSON.parse(process.argv[2]) : {};

const minSize = params["min_size"] != null ? Number(params["min_size"]) : 0;
const maxSize = params["max_size"] != null ? Number(params["max_size"]) : 10;
const keyType = (params["key_type"] as string | undefined) ?? "integer";
const minKey = params["min_key"] != null ? Number(params["min_key"]) : -1000;
const maxKey = params["max_key"] != null ? Number(params["max_key"]) : 1000;
const minVal = params["min_value"] != null ? Number(params["min_value"]) : -1000;
const maxVal = params["max_value"] != null ? Number(params["max_value"]) : 1000;

const testCases = getTestCases();

const keysGen = keyType === "string" ? text() : integers({ minValue: minKey, maxValue: maxKey });
const valsGen = integers({ minValue: minVal, maxValue: maxVal });
const gen = maps(keysGen, valsGen, { minSize, maxSize });

hegel(
  function conformance_hashmaps(tc) {
    const dict = tc.draw(gen);
    const entries = [...dict.entries()];
    const size = entries.length;

    let minKeyOut: string | number | null = null;
    let maxKeyOut: string | number | null = null;
    let minValueOut: number | null = null;
    let maxValueOut: number | null = null;

    if (size > 0) {
      let firstEntry = true;
      for (const [k, v] of entries) {
        const numVal = v as number;
        if (minValueOut === null || numVal < minValueOut) minValueOut = numVal;
        if (maxValueOut === null || numVal > maxValueOut) maxValueOut = numVal;

        if (keyType === "string") {
          const strKey = k as string;
          if (firstEntry || strKey < (minKeyOut as string)) minKeyOut = strKey;
          if (firstEntry || strKey > (maxKeyOut as string)) maxKeyOut = strKey;
        } else {
          const numKey = k as number;
          if (firstEntry || numKey < (minKeyOut as number)) minKeyOut = numKey;
          if (firstEntry || numKey > (maxKeyOut as number)) maxKeyOut = numKey;
        }
        firstEntry = false;
      }
    }

    writeMetrics({
      size,
      min_key: minKeyOut,
      max_key: maxKeyOut,
      min_value: minValueOut,
      max_value: maxValueOut,
    });
  },
  { testCases },
)();

process.exit(0);
