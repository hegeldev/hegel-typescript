import { describe, it, expect } from "vitest";
import { bigIntToTwosComplementLE, twosComplementLEToBigInt, fitsInt64 } from "../src/bytes.js";

describe("portable integer byte helpers", () => {
  it("uses Uint8Array without requiring Node Buffer", () => {
    for (const value of [0n, -1n, 128n, -129n, 1n << 128n, -(1n << 128n)]) {
      const bytes = bigIntToTwosComplementLE(value);
      expect(Object.getPrototypeOf(bytes)).toBe(Uint8Array.prototype);
      expect(twosComplementLEToBigInt(bytes)).toBe(value);
    }
    expect(twosComplementLEToBigInt(new Uint8Array([0xff, 0xfe]))).toBe(-257n);
  });

  it("distinguishes int64 from arbitrary precision bounds", () => {
    expect(fitsInt64(-(1n << 63n), (1n << 63n) - 1n)).toBe(true);
    expect(fitsInt64(0n, 1n << 63n)).toBe(false);
  });
});
