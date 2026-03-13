import { describe, it, expect } from "vitest";
import { version } from "hegel";

describe("version", () => {
  it("returns the library version string", () => {
    expect(version()).toBe("0.1.0");
  });
});
