import { describe, it, expect } from "vitest";
import { wtf8ToString } from "../src/wtf8.js";

describe("wtf8ToString portable bytes", () => {
  it.each([
    [[], ""],
    [[0, 97], "\0a"],
    [[0xc2, 0xa2], "¢"],
    [[0xe2, 0x82, 0xac], "€"],
    [[0xed, 0xa0, 0x80], "\ud800"],
    [[0xed, 0xbf, 0xbf], "\udfff"],
    [[0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80], "😀"],
    [[0xf0, 0x9f, 0x98, 0x80], "😀"],
  ] as const)("preserves code units in %j", (bytes, text) => {
    expect(wtf8ToString(Uint8Array.from(bytes))).toBe(text);
  });

  it("decodes long strings without exceeding JS argument limits", () => {
    expect(wtf8ToString(new Uint8Array(300_000).fill(97))).toBe("a".repeat(300_000));
  });
});
