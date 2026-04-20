import { describe, it, expect } from "vitest";
import { crc32 } from "../src/crc32.js";

const crc32Str = (s: string): number => crc32(Buffer.from(s, "utf-8"));

describe("crc32", () => {
  it("empty buffer is 0", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('"a" is 0xE8B7BE43', () => {
    expect(crc32Str("a")).toBe(0xe8b7be43);
  });

  it('"123456789" is 0xCBF43926 (standard check vector)', () => {
    expect(crc32Str("123456789")).toBe(0xcbf43926);
  });

  it("is deterministic on large buffers", () => {
    const zeros = new Uint8Array(1024 * 1024);
    const v1 = crc32(zeros);
    const v2 = crc32(zeros);
    expect(v1).toBe(v2);
    expect(v1).not.toBe(0);
  });

  it("different inputs hash differently", () => {
    expect(crc32Str("abc")).not.toBe(crc32Str("abd"));
  });

  it("returns an unsigned 32-bit integer", () => {
    // The final `^ 0xFFFFFFFF` produces a signed int32 before coercion;
    // check that every output stays in the unsigned range.
    const inputs = [
      new Uint8Array(0),
      new Uint8Array([0x00]),
      new Uint8Array([0xff, 0xff, 0xff, 0xff]),
      Buffer.from("hello, world"),
    ];
    for (const input of inputs) {
      const v = crc32(input);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it("accepts Buffer and Uint8Array equivalently", () => {
    const bytes = [1, 2, 3, 4, 5, 0xff, 0x00];
    expect(crc32(Buffer.from(bytes))).toBe(crc32(new Uint8Array(bytes)));
  });
});
