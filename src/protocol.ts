import { addExtension } from "cbor-x";
import { crc32 } from "./crc32.js";
import { wtf8ToString } from "./wtf8.js";

export const MAGIC = 0x4845474c;
export const HEADER_SIZE = 20;
export const TERMINATOR = 0x0a;
export const REPLY_BIT = 0x80000000;
export const CLOSE_STREAM_MESSAGE_ID = 0x7fffffff;
export const CLOSE_STREAM_PAYLOAD = Buffer.from([0xfe]);
export const HANDSHAKE_STRING = "hegel_handshake_start";

// cbor-x requires a Class for addExtension, but we only use the decode
// path (tag 91 is sent by the server, never by the client).
addExtension({
  /* v8 ignore start */
  Class: class HegelString {},
  tag: 91,
  encode: () => Buffer.alloc(0),
  /* v8 ignore stop */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decode(data: unknown): any {
    if (Buffer.isBuffer(data)) return wtf8ToString(data);
    if (data instanceof Uint8Array) return wtf8ToString(Buffer.from(data));
    return String(data);
  },
});

export interface Packet {
  streamId: number;
  messageId: number;
  isReply: boolean;
  payload: Buffer;
}

/**
 * Encode a packet into a single Buffer ready for writing.
 */
export function encodePacket(packet: Packet): Buffer {
  const messageIdRaw = packet.isReply ? (packet.messageId | REPLY_BIT) >>> 0 : packet.messageId;

  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32BE(MAGIC, 0);
  // checksum placeholder at offset 4 (already 0)
  header.writeUInt32BE(packet.streamId, 8);
  header.writeUInt32BE(messageIdRaw, 12);
  header.writeUInt32BE(packet.payload.length, 16);

  // CRC32 over header (checksum zeroed) + payload
  const checksum = crc32(Buffer.concat([header, packet.payload]));
  header.writeUInt32BE(checksum, 4);

  return Buffer.concat([header, packet.payload, Buffer.from([TERMINATOR])]);
}

/**
 * Decode a packet from raw bytes.
 *
 * @param readExact - Function that synchronously reads exactly `n` bytes.
 * @returns The decoded packet.
 */
export function readPacketFrom(readExact: (n: number) => Buffer): Packet {
  const header = readExact(HEADER_SIZE);

  const magic = header.readUInt32BE(0);
  if (magic !== MAGIC) {
    throw new Error(`Invalid magic: expected 0x${MAGIC.toString(16)}, got 0x${magic.toString(16)}`);
  }

  const checksum = header.readUInt32BE(4);
  const streamId = header.readUInt32BE(8);
  const messageIdRaw = header.readUInt32BE(12);
  const payloadLength = header.readUInt32BE(16);

  const isReply = (messageIdRaw & REPLY_BIT) !== 0;
  const messageId = messageIdRaw & ~REPLY_BIT;

  const payload = readExact(payloadLength);
  const terminator = readExact(1);

  if (terminator[0] !== TERMINATOR) {
    throw new Error(
      `Invalid terminator: expected 0x${TERMINATOR.toString(16)}, got 0x${terminator[0].toString(16)}`,
    );
  }

  // Verify CRC32
  const headerForCheck = Buffer.from(header);
  headerForCheck.writeUInt32BE(0, 4); // zero out checksum field
  const computed = crc32(Buffer.concat([headerForCheck, payload]));
  if (computed !== checksum) {
    throw new Error(
      `CRC32 mismatch: expected 0x${checksum.toString(16)}, got 0x${computed.toString(16)}`,
    );
  }

  return { streamId, messageId, isReply, payload };
}
