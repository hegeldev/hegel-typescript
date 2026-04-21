/**
 * Tests for uv discovery and installation, mirroring hegel-rust's
 * `tests/embedded/uv_tests.rs` and hegel-cpp's `tests/test_uv.cpp`.
 */

import { describe, test, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cacheDirFrom, findInPath, findUvImpl, installUvWithSh } from "../src/uv.js";

function uniqueTmp(name: string): string {
  const base = path.join(
    os.tmpdir(),
    `${name}-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
  );
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function rmrf(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}

describe("cacheDirFrom", () => {
  test("XDG_CACHE_HOME wins over HOME", () => {
    expect(cacheDirFrom("/tmp/xdg", "/home/test")).toBe(path.join("/tmp/xdg", "hegel"));
  });

  test("falls back to HOME/.cache/hegel when XDG unset", () => {
    expect(cacheDirFrom(null, "/home/test")).toBe(path.join("/home/test", ".cache", "hegel"));
  });

  test("throws when neither XDG nor HOME is available", () => {
    expect(() => cacheDirFrom(null, null)).toThrow(/Could not determine home directory/);
  });
});

describe("findInPath", () => {
  test("finds a known binary", () => {
    const name = process.platform === "win32" ? "cmd.exe" : "sh";
    expect(findInPath(name)).not.toBe(null);
  });

  test("returns null for a missing binary", () => {
    expect(findInPath("definitely_not_a_real_binary_xyz")).toBe(null);
  });
});

describe("findUvImpl", () => {
  test("prefers PATH uv over cache", () => {
    const tmp = uniqueTmp("hegel-uv-path");
    try {
      const fakeUv = path.join(tmp, "uv");
      fs.writeFileSync(fakeUv, "fake uv");
      const result = findUvImpl(fakeUv, "/nonexistent");
      expect(result).toBe(fakeUv);
    } finally {
      rmrf(tmp);
    }
  });

  test("returns cached uv when not on PATH", () => {
    const tmp = uniqueTmp("hegel-uv-cache");
    try {
      const cached = path.join(tmp, process.platform === "win32" ? "uv.exe" : "uv");
      fs.writeFileSync(cached, "fake uv");
      expect(findUvImpl(null, tmp)).toBe(cached);
    } finally {
      rmrf(tmp);
    }
  });

  // Integration test: actually downloads uv via the embedded installer.
  // Requires network access. Unix-only because the installer is a shell script.
  test.skipIf(process.platform === "win32")(
    "installs uv when neither PATH nor cache has it",
    async () => {
      const tmp = uniqueTmp("hegel-uv-install");
      try {
        const result = findUvImpl(null, tmp);
        const expected = path.join(tmp, "uv");
        expect(fs.existsSync(expected)).toBe(true);
        expect(result).toBe(expected);
      } finally {
        rmrf(tmp);
      }
    },
    120_000,
  );
});

describe("installUvWithSh", () => {
  test.skipIf(process.platform === "win32")("throws when sh is not a real shell", () => {
    const tmp = uniqueTmp("hegel-uv-badsh");
    try {
      expect(() => installUvWithSh(tmp, "definitely_not_a_real_shell_xyz")).toThrow(
        /Failed to run uv installer/,
      );
    } finally {
      rmrf(tmp);
    }
  });
});
