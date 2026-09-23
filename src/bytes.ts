const INT64_MIN = -0x8000000000000000n;
const INT64_MAX = 0x7fffffffffffffffn;

/** Whether both bounds fit `hegel_generate_integer`'s `int64_t` arguments. */
export function fitsInt64(min: bigint, max: bigint): boolean {
  return min >= INT64_MIN && max <= INT64_MAX;
}

/**
 * Encode a bigint as the minimal two's-complement little-endian byte buffer —
 * the wire format `hegel_generate_integer_big` consumes for its bounds.
 */
export function bigIntToTwosComplementLE(v: bigint): Uint8Array {
  const bytes: number[] = [];
  if (v >= 0n) {
    let x = v;
    for (;;) {
      const b = Number(x & 0xffn);
      x >>= 8n;
      bytes.push(b);
      // Done once nothing remains and the top bit reads as non-negative
      // (otherwise a trailing 0x00 sign byte is emitted next iteration).
      if (x === 0n && (b & 0x80) === 0) break;
    }
  } else {
    let x = v;
    for (;;) {
      const b = Number(x & 0xffn);
      // BigInt >> is arithmetic, so the sign extension never terminates on 0.
      x >>= 8n;
      bytes.push(b);
      // Done once only sign extension remains and the top bit reads negative.
      if (x === -1n && (b & 0x80) !== 0) break;
    }
  }
  return Uint8Array.from(bytes);
}

/** Decode a two's-complement little-endian byte buffer into a bigint. */
export function twosComplementLEToBigInt(buf: Uint8Array): bigint {
  let v = 0n;
  for (let i = buf.length - 1; i >= 0; i--) {
    v = (v << 8n) | BigInt(buf[i]);
  }
  if ((buf[buf.length - 1] & 0x80) !== 0) {
    v -= 1n << BigInt(buf.length * 8);
  }
  return v;
}
