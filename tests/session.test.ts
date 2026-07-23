import { describe, it, expect } from "vitest";
import { checkVersion, loadLibhegel, getLibhegel } from "../src/session.js";
import { LIBHEGEL_VERSION } from "../src/libhegel-version.js";

describe("checkVersion", () => {
  it("accepts a matching major.minor (any patch)", () => {
    expect(() => checkVersion("0.20.999", "0.20.1")).not.toThrow();
    expect(() => checkVersion(LIBHEGEL_VERSION)).not.toThrow();
  });

  it("rejects a different major.minor", () => {
    expect(() => checkVersion("0.21.0", "0.20.1")).toThrow(/Incompatible libhegel version/);
    expect(() => checkVersion("1.0.0", "0.20.1")).toThrow(/Incompatible libhegel version/);
  });
});

describe("global handle", () => {
  it("loadLibhegel loads a version-compatible library", () => {
    const lib = loadLibhegel();
    expect(lib.version()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("getLibhegel memoizes the handle", () => {
    const a = getLibhegel();
    const b = getLibhegel();
    expect(a).toBe(b);
  });
});
