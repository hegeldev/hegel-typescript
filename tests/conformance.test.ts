/**
 * Tests for the conformance helpers: getTestCases() and writeMetrics().
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTestCases, writeMetrics } from "hegel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Save and restore environment variables around a test. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
  try {
    fn();
  } finally {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// getTestCases
// ---------------------------------------------------------------------------

describe("getTestCases", () => {
  it("returns 50 when CONFORMANCE_TEST_CASES is not set", () => {
    withEnv({ CONFORMANCE_TEST_CASES: undefined }, () => {
      expect(getTestCases()).toBe(50);
    });
  });

  it("returns 50 when CONFORMANCE_TEST_CASES is empty string", () => {
    withEnv({ CONFORMANCE_TEST_CASES: "" }, () => {
      expect(getTestCases()).toBe(50);
    });
  });

  it("parses a valid positive integer", () => {
    withEnv({ CONFORMANCE_TEST_CASES: "100" }, () => {
      expect(getTestCases()).toBe(100);
    });
  });

  it("returns 50 for non-numeric value", () => {
    withEnv({ CONFORMANCE_TEST_CASES: "not-a-number" }, () => {
      expect(getTestCases()).toBe(50);
    });
  });

  it("returns 50 for zero", () => {
    withEnv({ CONFORMANCE_TEST_CASES: "0" }, () => {
      expect(getTestCases()).toBe(50);
    });
  });

  it("returns 50 for negative value", () => {
    withEnv({ CONFORMANCE_TEST_CASES: "-5" }, () => {
      expect(getTestCases()).toBe(50);
    });
  });

  it("parses 1 (minimum valid)", () => {
    withEnv({ CONFORMANCE_TEST_CASES: "1" }, () => {
      expect(getTestCases()).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// writeMetrics
// ---------------------------------------------------------------------------

describe("writeMetrics", () => {
  let tmpDir: string;
  let metricsFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conformance-test-"));
    metricsFile = path.join(tmpDir, "metrics.jsonl");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends a JSON line to the metrics file", () => {
    withEnv({ CONFORMANCE_METRICS_FILE: metricsFile }, () => {
      writeMetrics({ value: true });
      writeMetrics({ value: false });

      const content = fs.readFileSync(metricsFile, "utf8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toEqual({ value: true });
      expect(JSON.parse(lines[1]!)).toEqual({ value: false });
    });
  });

  it("creates the file if it does not exist", () => {
    withEnv({ CONFORMANCE_METRICS_FILE: metricsFile }, () => {
      expect(fs.existsSync(metricsFile)).toBe(false);
      writeMetrics({ value: 42 });
      expect(fs.existsSync(metricsFile)).toBe(true);
    });
  });

  it("throws when CONFORMANCE_METRICS_FILE is not set", () => {
    withEnv({ CONFORMANCE_METRICS_FILE: undefined }, () => {
      expect(() => writeMetrics({ value: 1 })).toThrow(
        "hegel: CONFORMANCE_METRICS_FILE env var not set",
      );
    });
  });

  it("throws when the metrics file path is a directory", () => {
    // Point to a directory so appendFileSync fails
    withEnv({ CONFORMANCE_METRICS_FILE: tmpDir }, () => {
      expect(() => writeMetrics({ value: 1 })).toThrow();
    });
  });

  it("writes various metric shapes", () => {
    withEnv({ CONFORMANCE_METRICS_FILE: metricsFile }, () => {
      writeMetrics({ value: 3.14, is_nan: false, is_infinite: false });
      writeMetrics({ length: 5 });
      writeMetrics({ size: 3, min_element: 1, max_element: 9 });

      const lines = fs.readFileSync(metricsFile, "utf8").trim().split("\n");
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]!)).toEqual({ value: 3.14, is_nan: false, is_infinite: false });
      expect(JSON.parse(lines[1]!)).toEqual({ length: 5 });
      expect(JSON.parse(lines[2]!)).toEqual({ size: 3, min_element: 1, max_element: 9 });
    });
  });

  it("escapes U+0085/U+2028/U+2029 so Python splitlines() doesn't break JSONL", () => {
    withEnv({ CONFORMANCE_METRICS_FILE: metricsFile }, () => {
      // These Unicode line terminators are NOT escaped by JSON.stringify,
      // but Python's splitlines() splits on them, breaking JSONL parsing.
      const nel = "\u0085"; // NEL
      const lineSep = "\u2028";
      const paraSep = "\u2029";
      writeMetrics({ a: `hello${nel}there`, b: `hi${lineSep}world`, c: `foo${paraSep}bar` });

      const raw = fs.readFileSync(metricsFile, "utf8");
      // The file should have exactly one \n (at the end) and no raw separators
      expect(raw).not.toContain(nel);
      expect(raw).not.toContain(lineSep);
      expect(raw).not.toContain(paraSep);
      // The escaped sequences should be present
      expect(raw).toContain("\\u0085");
      expect(raw).toContain("\\u2028");
      expect(raw).toContain("\\u2029");
      // The parsed value should round-trip correctly
      const parsed = JSON.parse(raw.trim());
      expect(parsed.a).toBe(`hello${nel}there`);
      expect(parsed.b).toBe(`hi${lineSep}world`);
      expect(parsed.c).toBe(`foo${paraSep}bar`);
    });
  });
});
