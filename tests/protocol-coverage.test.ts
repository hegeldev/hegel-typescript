/**
 * Additional protocol tests to cover CBOR tag 91 (HegelString) extension paths.
 *
 * The decode callback is exercised by decoding CBOR data containing tag 91.
 * The HegelString constructor (line 38) and encode callback (line 46) are
 * only reachable if a HegelString instance is passed to cbor-x encode, but
 * HegelString is not exported. We cannot directly test those lines without
 * modifying the source to export the class.
 *
 * What IS testable:
 * - decode with Buffer data (tag 91 containing bytes) -> line 52
 * - decode with Uint8Array data (tag 91 containing Uint8Array) -> line 53
 * - decode with non-buffer data (tag 91 containing a string) -> line 54
 */

import { describe, it, expect } from "vitest";
import { encode, Tag } from "cbor-x";
import { decodeValue } from "../src/protocol.js";

describe("CBOR tag 91 (WTF-8 string) decode paths", () => {
  it("decodes tag 91 with Buffer data to string", () => {
    // cbor-x will encode the Buffer as bytes, then on decode the extension
    // decode callback receives a Buffer -> hits line 52
    const tagged = new Tag(Buffer.from("hello"), 91);
    const encoded = encode(tagged);
    const decoded = decodeValue(Buffer.from(encoded));
    expect(decoded).toBe("hello");
  });

  it("decodes tag 91 with Uint8Array data to string", () => {
    // Encode a Uint8Array (non-Buffer) inside tag 91
    // On decode, cbor-x may pass a Uint8Array -> hits line 53
    const tagged = new Tag(new Uint8Array([104, 101, 108, 108, 111]), 91);
    const encoded = encode(tagged);
    const decoded = decodeValue(Buffer.from(encoded));
    expect(decoded).toBe("hello");
  });

  it("decodes tag 91 with non-buffer data via String() fallback", () => {
    // Encode a string directly inside tag 91 (not typical but exercises line 54)
    const tagged = new Tag("fallback test", 91);
    const encoded = encode(tagged);
    const decoded = decodeValue(Buffer.from(encoded));
    expect(decoded).toBe("fallback test");
  });

  it("decodes tag 91 with integer data via String() fallback", () => {
    // Encode a number inside tag 91 to hit the String(data) fallback
    const tagged = new Tag(42, 91);
    const encoded = encode(tagged);
    const decoded = decodeValue(Buffer.from(encoded));
    expect(decoded).toBe("42");
  });

  it("decodes tag 91 with empty buffer", () => {
    const tagged = new Tag(Buffer.alloc(0), 91);
    const encoded = encode(tagged);
    const decoded = decodeValue(Buffer.from(encoded));
    expect(decoded).toBe("");
  });

  it("decodes tag 91 with WTF-8 multi-byte characters", () => {
    // UTF-8 encoding of emoji (U+1F600): F0 9F 98 80
    const tagged = new Tag(Buffer.from([0xf0, 0x9f, 0x98, 0x80]), 91);
    const encoded = encode(tagged);
    const decoded = decodeValue(Buffer.from(encoded));
    expect(decoded).toBe("\u{1F600}");
  });
});
