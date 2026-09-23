import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeRuntime } from "../src/nodeRuntime.js";

const location = { class: "suite", function: "property", file: "test.ts", beginLine: 42 };

describe("nodeRuntime Antithesis IO", () => {
  it("does nothing without an output directory", () => {
    vi.stubEnv("ANTITHESIS_OUTPUT_DIR", "");
    try {
      nodeRuntime.emitAntithesisAssertion(location, true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("writes declaration and evaluation JSONL records with the test location", () => {
    const dir = mkdtempSync(join(tmpdir(), "hegel-antithesis-test-"));
    vi.stubEnv("ANTITHESIS_OUTPUT_DIR", dir);
    try {
      nodeRuntime.emitAntithesisAssertion(location, false);
      const records = readFileSync(join(dir, "sdk.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(records).toHaveLength(2);
      expect(records[0].antithesis_assert).toMatchObject({
        hit: false,
        must_hit: true,
        condition: false,
        id: "suite::property passes properties",
      });
      expect(records[1].antithesis_assert).toMatchObject({
        hit: true,
        condition: false,
        location: {
          class: "suite",
          function: "property",
          file: "test.ts",
          begin_line: 42,
          begin_column: 0,
        },
      });
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
