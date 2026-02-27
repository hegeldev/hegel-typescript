/**
 * Binary wire protocol for the Hegel SDK.
 *
 * Implements the 20-byte header packet format with CBOR payloads and CRC32
 * integrity checks.
 *
 * @packageDocumentation
 */

import { createRequire } from "module";
import * as net from "net";
import { encode, decode } from "cbor-x";

// Use Node's built-in zlib for CRC32 (same algorithm as Python's zlib.crc32)
const require = createRequire(import.meta.url);
const zlib = require("zlib") as typeof import("zlib");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Protocol version. */
export const PROTOCOL_VERSION = 0.1;

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
 * Special message ID used when closing a channel.
 * Chosen as `2**31 - 1` (= 0x7FFFFFFF) — the largest message ID that does not
 * overlap with the reply bit.
 *
 * Note: Do NOT write this as `(1 << 31) - 1` — JavaScript's `<<` operator
 * truncates to 32-bit signed, so `(1 << 31)` is `-2147483648`, making
 * `(1 << 31) - 1 = -2147483649`, which is wrong. Use `2**31 - 1` instead.
 */
export const CLOSE_CHANNEL_MESSAGE_ID = 2 ** 31 - 1;

/**
 * Special payload sent when closing a channel.
 * Value `0xFE` is invalid CBOR (reserved tag byte per RFC 8949), which
 * ensures it is never confused with a real message payload.
 */
export const CLOSE_CHANNEL_PAYLOAD: Buffer = Buffer.from([0xfe]);

/** Size of the packet header in bytes (5 × uint32). */
const HEADER_SIZE = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single message in the wire protocol. */
export interface Packet {
  /** The channel this packet belongs to. */
  channelId: number;
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

/**
 * Raised by {@link recvExact} when the socket's read timeout fires before any
 * bytes have been received for the current read. This is a _safe_ timeout:
 * no bytes have been consumed from the network buffer, so the socket can be
 * used again immediately.
 *
 * This is distinct from a mid-packet timeout (which would be a fatal
 * {@link ConnectionClosedError}).
 */
export class SocketIdleTimeoutError extends Error {
  constructor(message = "Socket idle timeout") {
    super(message);
    this.name = "SocketIdleTimeoutError";
  }
}

// ---------------------------------------------------------------------------
// Low-level socket I/O
// ---------------------------------------------------------------------------

/**
 * Read exactly `n` bytes from `socket`, waiting until they are all available.
 *
 * Uses Node's non-flowing (readable) stream mode: calls `socket.read()` when
 * the `readable` event fires, accumulating bytes until `n` have been received.
 * This avoids the pause/resume race condition that affects event-driven (flowing)
 * mode when multiple sequential reads are made on the same socket.
 *
 * If the socket has a timeout set (via `socket.setTimeout(ms)`) and the timeout
 * fires before any bytes arrive, throws {@link SocketIdleTimeoutError}. This is
 * safe — the socket can be reused immediately.
 *
 * @param socket - The Node.js net.Socket to read from.
 * @param n - The number of bytes to read.
 * @returns A Buffer containing exactly `n` bytes.
 * @throws {PartialPacketError} If the socket closes before any bytes arrive.
 * @throws {ConnectionClosedError} If the socket closes after some bytes arrive.
 * @throws {SocketIdleTimeoutError} If the socket timeout fires before any bytes arrive.
 */
export function recvExact(socket: net.Socket, n: number): Promise<Buffer> {
  if (n === 0) return Promise.resolve(Buffer.alloc(0));

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    function tryRead() {
      while (received < n) {
        const needed = n - received;
        const chunk = socket.read(needed) as Buffer | null;
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

    function onTimeout() {
      // Socket idle timeout. Only safe to abort if no bytes have been consumed yet.
      if (received === 0) {
        cleanup();
        reject(new SocketIdleTimeoutError());
      }
      // If bytes were received, a mid-packet timeout would corrupt the stream.
      // Do nothing — let the socket close via 'end' or 'error' instead.
    }

    function cleanup() {
      socket.removeListener("readable", tryRead);
      socket.removeListener("end", onEnd);
      socket.removeListener("error", onError);
      socket.removeListener("timeout", onTimeout);
    }

    socket.on("readable", tryRead);
    socket.on("end", onEnd);
    socket.on("error", onError);
    socket.on("timeout", onTimeout);

    // Try to read immediately in case data is already buffered
    tryRead();
  });
}

// ---------------------------------------------------------------------------
// Packet I/O
// ---------------------------------------------------------------------------

/**
 * Read and parse a single {@link Packet} from the socket.
 *
 * Reads the 20-byte header, then the payload, then the terminator byte.
 * Validates magic number, terminator, and CRC32 checksum.
 *
 * @param socket - The connected socket to read from.
 * @returns The parsed Packet.
 * @throws {Error} If the magic number, terminator, or checksum is invalid.
 */
export async function readPacket(socket: net.Socket): Promise<Packet> {
  const header = await recvExact(socket, HEADER_SIZE);

  const magic = header.readUInt32BE(0);
  const checksum = header.readUInt32BE(4);
  const channelId = header.readUInt32BE(8);
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

  const payload = await recvExact(socket, payloadLength);
  const terminatorBuf = await recvExact(socket, 1);
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

  return { channelId, messageId, isReply, payload };
}

/**
 * Serialize a {@link Packet} and write it to the socket.
 *
 * Computes the CRC32 over the header (with checksum zeroed) plus payload,
 * then sends header + payload + terminator as a single write.
 *
 * @param socket - The connected socket to write to.
 * @param packet - The packet to send.
 */
export function writePacket(socket: net.Socket, packet: Packet): Promise<void> {
  let messageId = packet.messageId;
  if (packet.isReply) {
    messageId = (messageId | REPLY_BIT) >>> 0;
  }

  // Build header with checksum zeroed, compute CRC, then fill in checksum
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32BE(MAGIC, 0);
  // offset 4 left as 0 for CRC computation
  header.writeUInt32BE(packet.channelId, 8);
  header.writeUInt32BE(messageId, 12);
  header.writeUInt32BE(packet.payload.length, 16);

  const checksum = zlib.crc32(Buffer.concat([header, packet.payload])) >>> 0;
  header.writeUInt32BE(checksum, 4);

  const frame = Buffer.concat([header, packet.payload, Buffer.from([TERMINATOR])]);

  return new Promise((resolve, reject) => {
    socket.write(frame, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// CBOR helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CBOR extractor helpers
// ---------------------------------------------------------------------------

/** Describe a value's type for error messages — handles the `typeof null === "object"` quirk. */
function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Extract an integer from a CBOR-decoded value.
 *
 * @param value - The CBOR-decoded value.
 * @param field - Field name for error messages.
 * @throws {TypeError} If the value is not a safe integer.
 */
export function extractInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`Expected integer for field '${field}', got ${describeType(value)}`);
  }
  return value;
}

/**
 * Extract a float (or integer promoted to float) from a CBOR-decoded value.
 *
 * @param value - The CBOR-decoded value.
 * @param field - Field name for error messages.
 * @throws {TypeError} If the value is not a number.
 */
export function extractFloat(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new TypeError(`Expected number for field '${field}', got ${describeType(value)}`);
  }
  return value;
}

/**
 * Extract a string from a CBOR-decoded value.
 *
 * @param value - The CBOR-decoded value.
 * @param field - Field name for error messages.
 * @throws {TypeError} If the value is not a string.
 */
export function extractString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Expected string for field '${field}', got ${describeType(value)}`);
  }
  return value;
}

/**
 * Extract a boolean from a CBOR-decoded value.
 *
 * @param value - The CBOR-decoded value.
 * @param field - Field name for error messages.
 * @throws {TypeError} If the value is not a boolean.
 */
export function extractBool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`Expected boolean for field '${field}', got ${describeType(value)}`);
  }
  return value;
}

/**
 * Extract a bytes buffer from a CBOR-decoded value.
 *
 * @param value - The CBOR-decoded value (expected to be a Buffer or Uint8Array).
 * @param field - Field name for error messages.
 * @throws {TypeError} If the value is not a Buffer/Uint8Array.
 */
export function extractBytes(value: unknown, field: string): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new TypeError(`Expected bytes for field '${field}', got ${describeType(value)}`);
}

/**
 * Extract an array from a CBOR-decoded value.
 *
 * @param value - The CBOR-decoded value.
 * @param field - Field name for error messages.
 * @throws {TypeError} If the value is not an array.
 */
export function extractList(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Expected array for field '${field}', got ${describeType(value)}`);
  }
  return value;
}

/**
 * Extract a plain object (dict) from a CBOR-decoded value.
 *
 * @param value - The CBOR-decoded value.
 * @param field - Field name for error messages.
 * @throws {TypeError} If the value is not a plain object (or is null/array).
 */
export function extractDict(value: unknown, field: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError(`Expected object for field '${field}', got ${describeType(value)}`);
  }
  return value as Record<string, unknown>;
}
