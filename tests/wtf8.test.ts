/**
 * Tests for WTF-8 decoder.
 * Test vectors adapted from https://github.com/mathiasbynens/wtf-8.
 */
import { describe, it, expect } from "vitest";
import { wtf8ToString } from "../src/wtf8.js";

describe("wtf8ToString", () => {
  // 1-byte sequences (U+0000 to U+007F)
  it("decodes ASCII (U+0000, U+005C, U+007F)", () => {
    expect(wtf8ToString(Buffer.from([0x00]))).toBe("\0");
    expect(wtf8ToString(Buffer.from([0x5c]))).toBe("\\");
    expect(wtf8ToString(Buffer.from([0x7f]))).toBe("\x7F");
  });

  // 2-byte sequences (U+0080 to U+07FF)
  it("decodes 2-byte sequences (U+0080, U+05CA, U+07FF)", () => {
    expect(wtf8ToString(Buffer.from([0xc2, 0x80]))).toBe("\u0080");
    expect(wtf8ToString(Buffer.from([0xd7, 0x8a]))).toBe("\u05CA");
    expect(wtf8ToString(Buffer.from([0xdf, 0xbf]))).toBe("\u07FF");
  });

  // 3-byte sequences (non-surrogate)
  it("decodes 3-byte sequences (U+0800, U+2C3C, U+FFFF)", () => {
    expect(wtf8ToString(Buffer.from([0xe0, 0xa0, 0x80]))).toBe("\u0800");
    expect(wtf8ToString(Buffer.from([0xe2, 0xb0, 0xbc]))).toBe("\u2C3C");
    expect(wtf8ToString(Buffer.from([0xef, 0xbf, 0xbf]))).toBe("\uFFFF");
  });

  // 4-byte sequences (supplementary plane)
  it("decodes 4-byte sequences (U+10000, U+1D306, U+10FFFF)", () => {
    expect(wtf8ToString(Buffer.from([0xf0, 0x90, 0x80, 0x80]))).toBe("\uD800\uDC00");
    expect(wtf8ToString(Buffer.from([0xf0, 0x9d, 0x8c, 0x86]))).toBe("\uD834\uDF06");
    expect(wtf8ToString(Buffer.from([0xf4, 0x8f, 0xbf, 0xbf]))).toBe("\uDBFF\uDFFF");
  });

  // Lone high surrogates (U+D800 to U+DBFF)
  it("preserves lone high surrogates (U+D800, U+D9AF, U+DBFF)", () => {
    expect(wtf8ToString(Buffer.from([0xed, 0xa0, 0x80]))).toBe("\uD800");
    expect(wtf8ToString(Buffer.from([0xed, 0xa6, 0xaf]))).toBe("\uD9AF");
    expect(wtf8ToString(Buffer.from([0xed, 0xaf, 0xbf]))).toBe("\uDBFF");
  });

  // Lone low surrogates (U+DC00 to U+DFFF)
  it("preserves lone low surrogates (U+DC00, U+DEEE, U+DFFF)", () => {
    expect(wtf8ToString(Buffer.from([0xed, 0xb0, 0x80]))).toBe("\uDC00");
    expect(wtf8ToString(Buffer.from([0xed, 0xbb, 0xae]))).toBe("\uDEEE");
    expect(wtf8ToString(Buffer.from([0xed, 0xbf, 0xbf]))).toBe("\uDFFF");
  });

  // Surrogate combinations
  it("high surrogate + high surrogate", () => {
    expect(wtf8ToString(Buffer.from([0xed, 0xa0, 0x80, 0xed, 0xa0, 0x80]))).toBe("\uD800\uD800");
  });

  it("high surrogate + non-surrogate", () => {
    expect(wtf8ToString(Buffer.from([0xed, 0xa0, 0x80, 0x41]))).toBe("\uD800A");
  });

  it("low surrogate + low surrogate", () => {
    expect(wtf8ToString(Buffer.from([0xed, 0xb0, 0x80, 0xed, 0xb0, 0x80]))).toBe("\uDC00\uDC00");
  });

  it("low surrogate + non-surrogate", () => {
    expect(wtf8ToString(Buffer.from([0xed, 0xb0, 0x80, 0x41]))).toBe("\uDC00A");
  });

  it("unmatched high, surrogate pair, unmatched high", () => {
    expect(
      wtf8ToString(Buffer.from([0xed, 0xa0, 0x80, 0xf0, 0x9d, 0x8c, 0x86, 0xed, 0xa0, 0x80])),
    ).toBe("\uD800\uD834\uDF06\uD800");
  });

  it("unmatched low, surrogate pair, unmatched low", () => {
    expect(
      wtf8ToString(Buffer.from([0xed, 0xb0, 0x80, 0xf0, 0x9d, 0x8c, 0x86, 0xed, 0xb0, 0x80])),
    ).toBe("\uDC00\uD834\uDF06\uDC00");
  });

  // Edge cases
  it("decodes empty buffer to empty string", () => {
    expect(wtf8ToString(Buffer.from([]))).toBe("");
  });
});
