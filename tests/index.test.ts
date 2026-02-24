import { describe, it, expect } from "vitest";
import { version } from "../src/index.js";

describe("version", () => {
  it("returns the SDK version string", () => {
    expect(version()).toBe("0.1.0");
  });
});
