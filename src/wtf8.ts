/**
 * WTF-8 decoder that preserves lone surrogates.
 *
 * WTF-8 is like UTF-8 but allows encoding of surrogate codepoints
 * (U+D800-U+DFFF). Node's `Buffer.toString("utf-8")` replaces these with
 * U+FFFD, but JS strings are UTF-16 and can represent lone surrogates natively.
 *
 * Based on the test vectors from {@link https://github.com/mathiasbynens/wtf-8}.
 *
 * @packageDocumentation
 */

/**
 * Decode a WTF-8 encoded buffer into a JS string, preserving lone surrogates.
 */
export function wtf8ToString(buf: Buffer): string {
  const codeUnits: number[] = [];
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    let cp: number;
    if (b < 0x80) {
      cp = b;
      i += 1;
    } else if (b < 0xe0) {
      cp = ((b & 0x1f) << 6) | (buf[i + 1] & 0x3f);
      i += 2;
    } else if (b < 0xf0) {
      cp = ((b & 0x0f) << 12) | ((buf[i + 1] & 0x3f) << 6) | (buf[i + 2] & 0x3f);
      i += 3;
    } else {
      cp =
        ((b & 0x07) << 18) |
        ((buf[i + 1] & 0x3f) << 12) |
        ((buf[i + 2] & 0x3f) << 6) |
        (buf[i + 3] & 0x3f);
      i += 4;
    }
    if (cp >= 0x10000) {
      cp -= 0x10000;
      codeUnits.push(0xd800 + (cp >> 10));
      codeUnits.push(0xdc00 + (cp & 0x3ff));
    } else {
      codeUnits.push(cp);
    }
  }
  return String.fromCharCode(...codeUnits);
}
