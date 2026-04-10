/**
 * Binary wire protocol for the Hegel library.
 *
 * Implements the 20-byte header packet format with CBOR payloads and CRC32
 * integrity checks.
 *
 * @packageDocumentation
 */

import { createRequire } from "module";
import * as stream from "node:stream";
import { encode, decode, addExtension } from "cbor-x";

// Use Node's built-in zlib for CRC32 (same algorithm as Python's zlib.crc32)
const require = createRequire(import.meta.url);
const zlib = require("zlib") as typeof import("zlib");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Magic cookie: "HEGL" in hex (0x48 0x45 0x47 0x4C). */
export const MAGIC = 0x4845474c;

/**
 * High bit of message_id — marks a message as a reply.
 *
 * Written as a hex literal rather than `1 << 31` because JavaScript's `<<`
 * operator returns a signed 32-bit integer, making `1 << 31 === -2147483648`.
 * The hex form is unsigned and unambiguous.
 */
export const REPLY_BIT = 0x80000000;

/** Single byte appended after every packet payload. */
export const TERMINATOR = 0x0a;

/**
 * Special message ID used when closing a stream.
 * Chosen as `2**31 - 1` (= 0x7FFFFFFF) — the largest message ID that does not
 * overlap with the reply bit.
 *
 * Note: Do NOT write this as `(1 << 31) - 1` — JavaScript's `<<` operator
 * truncates to 32-bit signed, so `(1 << 31)` is `-2147483648`, making
 * `(1 << 31) - 1 = -2147483649`, which is wrong. Use `2**31 - 1` instead.
 */
export const CLOSE_STREAM_MESSAGE_ID = 2 ** 31 - 1;

/**
 * Special payload sent when closing a stream.
 * Value `0xFE` is invalid CBOR (reserved tag byte per RFC 8949), which
 * ensures it is never confused with a real message payload.
 */
export const CLOSE_STREAM_PAYLOAD: Buffer = Buffer.from([0xfe]);

/** Size of the packet header in bytes (5 × uint32). */
const HEADER_SIZE = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single message in the wire protocol. */
export interface Packet {
  /** The stream this packet belongs to. */
  streamId: number;
  /** The message identifier (without the reply bit). */
  messageId: number;
  /** Whether this packet is a reply to a previous message. */
  isReply: boolean;
  /** The raw CBOR-encoded payload bytes. */
  payload: Buffer;
}

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

/**
 * Raised when the connection is closed cleanly before any bytes of a new
 * packet have been received. Indicates the remote peer shut down gracefully.
 */
export class PartialPacketError extends Error {
  constructor(message = "Connection closed before packet start") {
    super(message);
    this.name = "PartialPacketError";
  }
}

/**
 * Raised when the connection is closed unexpectedly in the middle of reading
 * a packet (i.e. some bytes were received but not all).
 */
export class ConnectionClosedError extends Error {
  constructor(message = "Connection closed while reading data") {
    super(message);
    this.name = "ConnectionClosedError";
  }
}

// ---------------------------------------------------------------------------
// Low-level stream I/O
// ---------------------------------------------------------------------------

/**
 * Read exactly `n` bytes from a readable stream.
 *
 * Uses Node's non-flowing (readable) stream mode: calls `reader.read()` when
 * the `readable` event fires, accumulating bytes until `n` have been received.
 * This avoids the pause/resume race condition that affects event-driven (flowing)
 * mode when multiple sequential reads are made on the same stream.
 *
 * @param reader - A Node.js Readable stream to read from.
 * @param n - The number of bytes to read.
 * @returns A Buffer containing exactly `n` bytes.
 * @throws {PartialPacketError} If the stream closes before any bytes arrive.
 * @throws {ConnectionClosedError} If the stream closes after some bytes arrive.
 */
export function recvExact(reader: stream.Readable, n: number): Promise<Buffer> {
  if (n === 0) return Promise.resolve(Buffer.alloc(0));

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    function tryRead() {
      while (received < n) {
        const needed = n - received;
        const chunk = reader.read(needed) as Buffer | null;
        if (chunk === null) break;
        chunks.push(chunk);
        received += chunk.length;
      }
      if (received >= n) {
        cleanup();
        resolve(Buffer.concat(chunks).subarray(0, n));
      }
    }

    function onEnd() {
      cleanup();
      if (received === 0) {
        reject(new PartialPacketError("Connection closed before packet start"));
      } else {
        reject(new ConnectionClosedError("Connection closed while reading data"));
      }
    }

    function onError(err: Error) {
      cleanup();
      reject(err);
    }

    function cleanup() {
      reader.removeListener("readable", tryRead);
      reader.removeListener("end", onEnd);
      reader.removeListener("error", onError);
    }

    reader.on("readable", tryRead);
    reader.on("end", onEnd);
    reader.on("error", onError);

    // Try to read immediately in case data is already buffered
    tryRead();
  });
}

// ---------------------------------------------------------------------------
// Packet I/O
// ---------------------------------------------------------------------------

/**
 * Read and parse a single {@link Packet} from a readable stream.
 *
 * Reads the 20-byte header, then the payload, then the terminator byte.
 * Validates magic number, terminator, and CRC32 checksum.
 *
 * @param reader - The readable stream to read from.
 * @returns The parsed Packet.
 * @throws {Error} If the magic number, terminator, or checksum is invalid.
 */
export async function readPacket(reader: stream.Readable): Promise<Packet> {
  const header = await recvExact(reader, HEADER_SIZE);

  const magic = header.readUInt32BE(0);
  const checksum = header.readUInt32BE(4);
  const streamId = header.readUInt32BE(8);
  let messageId = header.readUInt32BE(12);
  const payloadLength = header.readUInt32BE(16);

  if (magic !== MAGIC) {
    throw new Error(
      `Invalid magic number: expected 0x${MAGIC.toString(16).toUpperCase()}, got 0x${magic.toString(16).toUpperCase()}`,
    );
  }

  const isReply = (messageId & REPLY_BIT) !== 0;
  if (isReply) {
    messageId = messageId ^ REPLY_BIT;
  }

  const payload = await recvExact(reader, payloadLength);
  const terminatorBuf = await recvExact(reader, 1);
  const terminator = terminatorBuf[0];

  if (terminator !== TERMINATOR) {
    throw new Error(
      `Invalid terminator: expected 0x${TERMINATOR.toString(16).padStart(2, "0").toUpperCase()}, got 0x${terminator.toString(16).padStart(2, "0").toUpperCase()}`,
    );
  }

  // Verify CRC32: zero the checksum field in place, compute, then restore
  header.writeUInt32BE(0, 4);
  const computed = zlib.crc32(Buffer.concat([header, payload])) >>> 0;
  if (computed !== checksum) {
    throw new Error(
      `Checksum mismatch: expected 0x${checksum.toString(16).padStart(8, "0").toUpperCase()}, got 0x${computed.toString(16).padStart(8, "0").toUpperCase()}`,
    );
  }

  return { streamId, messageId, isReply, payload };
}

/**
 * Serialize a {@link Packet} and write it to a writable stream.
 *
 * Computes the CRC32 over the header (with checksum zeroed) plus payload,
 * then sends header + payload + terminator as a single write.
 *
 * @param writer - The writable stream to write to.
 * @param packet - The packet to send.
 */
export function writePacket(writer: stream.Writable, packet: Packet): Promise<void> {
  let messageId = packet.messageId;
  if (packet.isReply) {
    messageId = (messageId | REPLY_BIT) >>> 0;
  }

  // Build header with checksum zeroed, compute CRC, then fill in checksum
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32BE(MAGIC, 0);
  // offset 4 left as 0 for CRC computation
  header.writeUInt32BE(packet.streamId, 8);
  header.writeUInt32BE(messageId, 12);
  header.writeUInt32BE(packet.payload.length, 16);

  const checksum = zlib.crc32(Buffer.concat([header, packet.payload])) >>> 0;
  header.writeUInt32BE(checksum, 4);

  const frame = Buffer.concat([header, packet.payload, Buffer.from([TERMINATOR])]);

  return new Promise((resolve, reject) => {
    writer.write(frame, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// CBOR helpers
// ---------------------------------------------------------------------------

// Register CBOR Tag 6 (hegel string): the server wraps all string values as
// Tag 6 containing WTF-8 encoded bytes. WTF-8 is like UTF-8 but allows lone
// surrogate codepoints (U+D800-U+DFFF), which JS strings can represent natively.
import { wtf8ToString } from "./wtf8.js";

/** Sentinel class for CBOR Tag 6 (hegel string). Decode-only — never instantiated. */
export class _HegelString {}
addExtension({
  tag: 6,
  Class: _HegelString,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  encode: () => null as any,
  decode: wtf8ToString,
});

/**
 * Encode a value to CBOR bytes.
 *
 * @param value - Any JSON-compatible value (or Buffer for bytes).
 * @returns A Buffer containing the CBOR encoding.
 */
export function encodeValue(value: unknown): Buffer {
  return encode(value);
}

/**
 * Decode CBOR bytes to a value.
 *
 * @param data - A Buffer containing CBOR-encoded data.
 * @returns The decoded value.
 */
export function decodeValue(data: Buffer): unknown {
  return decode(data);
}
