/**
 * Tests for the binary wire protocol: encodePacket/readPacketFrom round-trips,
 * encodeValue/decodeValue round-trips, and protocol constants.
 *
 * Ported from the old protocol tests. Skips socket-based readPacket/writePacket
 * and recvExact tests since the new protocol uses synchronous readPacketFrom
 * with a readExact callback instead of sockets.
 */

import { describe, it, expect } from "vitest";
import {
  MAGIC,
  REPLY_BIT,
  TERMINATOR,
  CLOSE_STREAM_MESSAGE_ID,
  CLOSE_STREAM_PAYLOAD,
  HEADER_SIZE,
  HANDSHAKE_STRING,
  type Packet,
  encodePacket,
  readPacketFrom,
  encodeValue,
  decodeValue,
} from "../src/protocol.js";
import { crc32 } from "../src/crc32.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a readExact function backed by a buffer.
 * Reads bytes sequentially from the buffer.
 */
function bufferReader(buf: Buffer): (n: number) => Buffer {
  let offset = 0;
  return (n: number): Buffer => {
    if (offset + n > buf.length) {
      throw new Error("Not enough data in buffer");
    }
    const result = buf.subarray(offset, offset + n);
    offset += n;
    return Buffer.from(result);
  };
}

/** Build a raw wire packet buffer for testing. */
function makeRawPacket({
  magic = MAGIC,
  checksum,
  streamId = 0,
  messageId = 1,
  payload = Buffer.from("payload"),
  terminator = TERMINATOR,
}: {
  magic?: number;
  checksum?: number;
  streamId?: number;
  messageId?: number;
  payload?: Buffer;
  terminator?: number;
} = {}): Buffer {
  const headerForCheck = Buffer.alloc(20);
  headerForCheck.writeUInt32BE(magic, 0);
  headerForCheck.writeUInt32BE(0, 4); // checksum field zeroed
  headerForCheck.writeUInt32BE(streamId, 8);
  headerForCheck.writeUInt32BE(messageId, 12);
  headerForCheck.writeUInt32BE(payload.length, 16);

  const crcVal = checksum ?? crc32(Buffer.concat([headerForCheck, payload]));

  const header = Buffer.alloc(20);
  header.writeUInt32BE(magic, 0);
  header.writeUInt32BE(crcVal, 4);
  header.writeUInt32BE(streamId, 8);
  header.writeUInt32BE(messageId, 12);
  header.writeUInt32BE(payload.length, 16);

  return Buffer.concat([header, payload, Buffer.from([terminator])]);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("MAGIC == 0x4845474C", () => {
    expect(MAGIC).toBe(0x4845474c);
  });

  it("REPLY_BIT == 0x80000000", () => {
    expect(REPLY_BIT).toBe(0x80000000);
  });

  it("TERMINATOR == 0x0A", () => {
    expect(TERMINATOR).toBe(0x0a);
  });

  it("HEADER_SIZE == 20", () => {
    expect(HEADER_SIZE).toBe(20);
  });

  it("CLOSE_STREAM_MESSAGE_ID == 2**31 - 1 (0x7FFFFFFF)", () => {
    expect(CLOSE_STREAM_MESSAGE_ID).toBe(2 ** 31 - 1);
  });

  it("CLOSE_STREAM_PAYLOAD is 0xFE byte", () => {
    expect(CLOSE_STREAM_PAYLOAD).toEqual(Buffer.from([0xfe]));
  });

  it("HANDSHAKE_STRING is correct", () => {
    expect(HANDSHAKE_STRING).toBe("hegel_handshake_start");
  });
});

// ---------------------------------------------------------------------------
// Packet encode/decode round-trip via encodePacket + readPacketFrom
// ---------------------------------------------------------------------------

describe("packet round-trip (encodePacket + readPacketFrom)", () => {
  it("basic payload", () => {
    const p: Packet = { streamId: 0, messageId: 1, isReply: false, payload: Buffer.from("hello") };
    const encoded = encodePacket(p);
    const decoded = readPacketFrom(bufferReader(encoded));
    expect(decoded).toEqual(p);
  });

  it("empty payload", () => {
    const p: Packet = { streamId: 0, messageId: 1, isReply: false, payload: Buffer.alloc(0) };
    const encoded = encodePacket(p);
    const decoded = readPacketFrom(bufferReader(encoded));
    expect(decoded).toEqual(p);
  });

  it("reply bit set", () => {
    const p: Packet = {
      streamId: 1,
      messageId: 42,
      isReply: true,
      payload: Buffer.from("response"),
    };
    const encoded = encodePacket(p);
    const decoded = readPacketFrom(bufferReader(encoded));
    expect(decoded).toEqual(p);
  });

  it("large stream ID (0xFFFFFFFF)", () => {
    const p: Packet = {
      streamId: 0xffffffff,
      messageId: 1,
      isReply: false,
      payload: Buffer.from("data"),
    };
    const encoded = encodePacket(p);
    const decoded = readPacketFrom(bufferReader(encoded));
    expect(decoded).toEqual(p);
  });

  it("large message ID (2**31 - 1 = 0x7FFFFFFF)", () => {
    const p: Packet = {
      streamId: 0,
      messageId: 2 ** 31 - 1,
      isReply: false,
      payload: Buffer.from("data"),
    };
    const encoded = encodePacket(p);
    const decoded = readPacketFrom(bufferReader(encoded));
    expect(decoded).toEqual(p);
  });

  it("binary payload (all byte values)", () => {
    const payload = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const p: Packet = { streamId: 3, messageId: 7, isReply: false, payload };
    const encoded = encodePacket(p);
    const decoded = readPacketFrom(bufferReader(encoded));
    expect(decoded).toEqual(p);
  });
});

// ---------------------------------------------------------------------------
// readPacketFrom error handling
// ---------------------------------------------------------------------------

describe("readPacketFrom error handling", () => {
  it("throws on invalid magic number", () => {
    const raw = makeRawPacket({ magic: 0xdeadbeef });
    expect(() => readPacketFrom(bufferReader(raw))).toThrow(/Invalid magic/);
  });

  it("throws on invalid terminator", () => {
    const raw = makeRawPacket({ terminator: 0xff });
    expect(() => readPacketFrom(bufferReader(raw))).toThrow(/Invalid terminator/);
  });

  it("throws on checksum mismatch", () => {
    const raw = makeRawPacket({ checksum: 0x12345678 });
    expect(() => readPacketFrom(bufferReader(raw))).toThrow(/CRC32 mismatch/);
  });
});

// ---------------------------------------------------------------------------
// CBOR encode/decode round-trips
// ---------------------------------------------------------------------------

describe("CBOR encode/decode", () => {
  const cases: [string, unknown][] = [
    ["integer", 42],
    ["negative integer", -17],
    ["float", 3.14],
    ["string", "hello, world"],
    ["boolean true", true],
    ["boolean false", false],
    ["null", null],
    ["bytes", Buffer.from([1, 2, 3])],
    ["empty list", []],
    ["list of ints", [1, 2, 3]],
    ["dict", { a: 1, b: "two" }],
    ["nested list of dicts", [{ x: 1 }, { y: 2 }]],
    ["dict with list values", { nums: [1, 2, 3], str: "hi" }],
  ];

  for (const [name, value] of cases) {
    it(`round-trips ${name}`, () => {
      const encoded = encodeValue(value);
      const decoded = decodeValue(encoded);
      expect(decoded).toEqual(value);
    });
  }
});
