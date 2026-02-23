/**
 * Binary wire protocol for the Hegel SDK.
 *
 * Packets consist of a 20-byte big-endian header (magic, CRC32 checksum,
 * channel ID, message ID, payload length), followed by CBOR-encoded payload
 * bytes, followed by a single terminator byte (0x0A).
 *
 * @packageDocumentation
 */

import * as net from "net";
import * as zlib from "zlib";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Protocol version. */
export const PROTOCOL_VERSION = 0.1;

/** Magic cookie: "HEGL" in ASCII hex. */
export const MAGIC = 0x4845474c;

/**
 * Number of bytes in the packet header (5 × uint32 big-endian).
 * Layout: magic | checksum | channelId | messageId | payloadLength
 */
export const HEADER_SIZE = 20;

/** Packet terminator byte appended after the payload. */
export const TERMINATOR = 0x0a;

/**
 * If set in the on-wire message ID, this packet is a reply to a previous
 * message.
 *
 * Using `2 ** 31` (rather than `1 << 31`) keeps the value as an unsigned
 * float-backed number; JS bitwise left-shift returns a signed 32-bit int.
 */
export const REPLY_BIT = 2 ** 31; // 0x80000000

/**
 * Special message ID used when closing a channel.
 * Equals `(2 ** 31) - 1` (i.e. `0x7FFFFFFF`).
 */
export const CLOSE_CHANNEL_MESSAGE_ID = 2 ** 31 - 1;

/**
 * Special payload sent when closing a channel.
 * This byte (`0xFE`) is intentionally invalid CBOR (a reserved tag byte),
 * so it cannot be confused with a normal message.
 */
export const CLOSE_CHANNEL_PAYLOAD = Buffer.from([0xfe]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single message in the wire protocol. */
export interface Packet {
  /** Numeric channel identifier. */
  channelId: number;
  /** Numeric message identifier (without the reply bit). */
  messageId: number;
  /** True if this packet is a reply to a previous message. */
  isReply: boolean;
  /** Raw CBOR-encoded payload bytes. */
  payload: Buffer;
}

/**
 * Raised when the connection closes in the middle of reading a packet header.
 * Distinct from a mid-payload close so callers can treat a clean inter-packet
 * EOF differently from a truncated stream.
 */
export class PartialPacket extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartialPacket";
  }
}

// ---------------------------------------------------------------------------
// CRC32 helper
// ---------------------------------------------------------------------------

/**
 * Compute a CRC32 checksum using Node.js built-in zlib.
 *
 * @param data - The bytes to checksum.
 * @returns An unsigned 32-bit CRC32 value.
 */
function crc32(data: Buffer): number {
  return (
    (zlib as unknown as { crc32: (buf: Buffer) => number }).crc32(data) >>> 0
  );
}

// ---------------------------------------------------------------------------
// Low-level socket I/O
// ---------------------------------------------------------------------------

/**
 * Read exactly `n` bytes from `socket`, waiting until all bytes arrive.
 *
 * Uses `socket.read()` in paused mode so that multiple sequential calls
 * on the same socket correctly consume bytes without data races or
 * double-consumption.
 *
 * @param socket - A connected Node.js TCP socket.
 * @param n - Number of bytes to read.
 * @returns A Buffer containing exactly `n` bytes.
 * @throws {@link PartialPacket} if the connection closes before any data
 *   arrives (i.e. a clean inter-packet EOF).
 * @throws `Error` if the connection closes after some bytes have
 *   already been received (truncated stream).
 */
export function recvExact(socket: net.Socket, n: number): Promise<Buffer> {
  if (n === 0) return Promise.resolve(Buffer.alloc(0));

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    function tryRead(): void {
      while (received < n) {
        const want = n - received;
        const chunk = socket.read(want) as Buffer | null;
        if (chunk === null) {
          // No data available yet — wait for 'readable'
          socket.once("readable", tryRead);
          socket.once("end", onEnd);
          socket.once("error", onError);
          socket.once("close", onClose);
          return;
        }
        chunks.push(chunk);
        received += chunk.length;
      }
      // Got everything
      socket.off("end", onEnd);
      socket.off("error", onError);
      socket.off("close", onClose);
      resolve(Buffer.concat(chunks).subarray(0, n));
    }

    function onEnd(): void {
      socket.off("readable", tryRead);
      socket.off("error", onError);
      socket.off("close", onClose);
      if (received === 0) {
        reject(
          new PartialPacket(
            "Connection closed partway through reading packet.",
          ),
        );
      } else {
        reject(
          new Error(
            `Connection closed while reading data (got ${received} of ${n} bytes)`,
          ),
        );
      }
    }

    function onError(err: Error): void {
      socket.off("readable", tryRead);
      socket.off("end", onEnd);
      socket.off("close", onClose);
      reject(err);
    }

    function onClose(): void {
      socket.off("readable", tryRead);
      socket.off("error", onError);
      // Treat an abrupt close the same as a clean TCP half-close (FIN)
      onEnd();
    }

    tryRead();
  });
}

// ---------------------------------------------------------------------------
// Packet I/O
// ---------------------------------------------------------------------------

/**
 * Read and parse a single {@link Packet} from `socket`.
 *
 * The function reads the 20-byte header, validates the magic cookie and CRC32
 * checksum, then reads the payload and terminator byte.
 *
 * @param socket - A connected TCP socket.
 * @returns The parsed packet.
 * @throws {@link PartialPacket} on a clean inter-packet EOF.
 * @throws `Error` on magic mismatch, checksum mismatch, or bad terminator.
 */
export async function readPacket(socket: net.Socket): Promise<Packet> {
  // --- header ---
  const header = await recvExact(socket, HEADER_SIZE);

  const magic = header.readUInt32BE(0);
  const checksum = header.readUInt32BE(4);
  const channelId = header.readUInt32BE(8);
  let messageId = header.readUInt32BE(12);
  const length = header.readUInt32BE(16);

  // Extract and clear the reply flag
  const isReply = (messageId & REPLY_BIT) !== 0;
  if (isReply) {
    messageId = messageId ^ REPLY_BIT;
  }

  if (magic !== MAGIC) {
    throw new Error(
      `Invalid magic number: expected 0x${MAGIC.toString(16).toUpperCase().padStart(8, "0")}, ` +
        `got 0x${magic.toString(16).toUpperCase().padStart(8, "0")}`,
    );
  }

  // --- payload ---
  const payload = await recvExact(socket, length);

  // --- terminator ---
  const terminatorBuf = await recvExact(socket, 1);
  const terminator = terminatorBuf[0];
  if (terminator !== TERMINATOR) {
    throw new Error(
      `Invalid terminator: expected 0x${TERMINATOR.toString(16).padStart(2, "0").toUpperCase()}, ` +
        `got 0x${terminator.toString(16).padStart(2, "0").toUpperCase()}`,
    );
  }

  // --- CRC32 verification ---
  // Re-build the header with the checksum field zeroed, then hash header+payload.
  const headerForCheck = Buffer.from(header);
  headerForCheck.writeUInt32BE(0, 4);
  const computedCrc = crc32(Buffer.concat([headerForCheck, payload]));
  if (computedCrc !== checksum) {
    throw new Error(
      `Checksum mismatch: expected 0x${checksum.toString(16).toUpperCase().padStart(8, "0")}, ` +
        `got 0x${computedCrc.toString(16).toUpperCase().padStart(8, "0")}`,
    );
  }

  return { channelId, messageId, isReply, payload };
}

/**
 * Serialize `packet` and write it to `socket`.
 *
 * @param socket - A connected TCP socket.
 * @param packet - The packet to send.
 */
export async function writePacket(
  socket: net.Socket,
  packet: Packet,
): Promise<void> {
  let wireMessageId = packet.messageId;
  if (packet.isReply) {
    wireMessageId = (wireMessageId | REPLY_BIT) >>> 0;
  }

  // Build header with zeroed checksum to compute CRC
  const header = Buffer.allocUnsafe(HEADER_SIZE);
  header.writeUInt32BE(MAGIC, 0);
  header.writeUInt32BE(0, 4); // placeholder
  header.writeUInt32BE(packet.channelId >>> 0, 8);
  header.writeUInt32BE(wireMessageId >>> 0, 12);
  header.writeUInt32BE(packet.payload.length >>> 0, 16);

  const checksum = crc32(Buffer.concat([header, packet.payload]));
  header.writeUInt32BE(checksum, 4);

  const frame = Buffer.concat([
    header,
    packet.payload,
    Buffer.from([TERMINATOR]),
  ]);

  await new Promise<void>((resolve, reject) => {
    socket.write(frame, (err?: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// CBOR extractor helpers
// ---------------------------------------------------------------------------

/**
 * Return a lowercase type label suitable for error messages.
 * Distinguishes `null`, `array`, and plain `object` from each other.
 */
function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Extract an integer from a CBOR-decoded value.
 *
 * Accepts only values whose `typeof` is `"number"` **and** that are integer
 * (i.e. `Number.isInteger(value)`). Floats are rejected.
 *
 * @param value - A CBOR-decoded value.
 * @returns The integer.
 * @throws `TypeError` if the value is not an integer.
 */
export function extractInt(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throw new TypeError(
    `Expected int, got ${typeName(value)}` +
      (typeof value === "number" ? ` (${value})` : ""),
  );
}

/**
 * Extract a floating-point number from a CBOR-decoded value.
 *
 * Accepts any JavaScript `number` (integers are valid floats in CBOR).
 *
 * @param value - A CBOR-decoded value.
 * @returns The number.
 * @throws `TypeError` if the value is not a number.
 */
export function extractFloat(value: unknown): number {
  if (typeof value === "number") return value;
  throw new TypeError(`Expected float, got ${typeName(value)}`);
}

/**
 * Extract a string from a CBOR-decoded value.
 *
 * @param value - A CBOR-decoded value.
 * @returns The string.
 * @throws `TypeError` if the value is not a string.
 */
export function extractString(value: unknown): string {
  if (typeof value === "string") return value;
  throw new TypeError(`Expected string, got ${typeName(value)}`);
}

/**
 * Extract a boolean from a CBOR-decoded value.
 *
 * @param value - A CBOR-decoded value.
 * @returns The boolean.
 * @throws `TypeError` if the value is not a boolean.
 */
export function extractBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  throw new TypeError(`Expected bool, got ${typeName(value)}`);
}

/**
 * Extract a byte string from a CBOR-decoded value.
 *
 * CBOR byte strings are decoded by cbor2 as `Uint8Array`.
 *
 * @param value - A CBOR-decoded value.
 * @returns The `Uint8Array`.
 * @throws `TypeError` if the value is not a `Uint8Array`.
 */
export function extractBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new TypeError(`Expected bytes, got ${typeName(value)}`);
}

/**
 * Extract an array (CBOR list) from a CBOR-decoded value.
 *
 * @param value - A CBOR-decoded value.
 * @returns The array.
 * @throws `TypeError` if the value is not an array.
 */
export function extractList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  throw new TypeError(`Expected list, got ${typeName(value)}`);
}

/**
 * Extract a map (CBOR dict) from a CBOR-decoded value.
 *
 * Expects a plain JavaScript object (not an array, not null).
 *
 * @param value - A CBOR-decoded value.
 * @returns The record object.
 * @throws `TypeError` if the value is not a plain object.
 */
export function extractDict(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new TypeError(`Expected dict, got ${typeName(value)}`);
}
