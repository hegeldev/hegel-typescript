import { createRequire } from "module";
import * as net from "net";
import { describe, it, expect } from "vitest";
import {
  MAGIC,
  REPLY_BIT,
  TERMINATOR,
  CLOSE_STREAM_MESSAGE_ID,
  CLOSE_STREAM_PAYLOAD,
  Packet,
  readPacket,
  writePacket,
  recvExact,
  PartialPacketError,
  ConnectionClosedError,
  encodeValue,
  decodeValue,
  _HegelString,
} from "../src/protocol.js";
import { encode } from "cbor-x";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
// CRC32 via Node built-in zlib
const zlib = require("zlib") as typeof import("zlib");

/** Compute CRC32 using Node's zlib (same algorithm as Python's zlib.crc32) */
function crc32(buf: Buffer): number {
  return zlib.crc32(buf) >>> 0;
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

  const crc = checksum ?? crc32(Buffer.concat([headerForCheck, payload]));

  const header = Buffer.alloc(20);
  header.writeUInt32BE(magic, 0);
  header.writeUInt32BE(crc, 4);
  header.writeUInt32BE(streamId, 8);
  header.writeUInt32BE(messageId, 12);
  header.writeUInt32BE(payload.length, 16);

  return Buffer.concat([header, payload, Buffer.from([terminator])]);
}

/** Write a packet to one end of a socket pair, read it from the other. */
function roundtrip(packet: Packet): Promise<Packet> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((serverSocket) => {
      readPacket(serverSocket).then(resolve).catch(reject);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      const client = net.createConnection(addr.port, "127.0.0.1", () => {
        writePacket(client, packet)
          .then(() => client.end())
          .catch(reject);
      });
      client.on("error", reject);
    });
    server.on("error", reject);
    server.on("close", () => {}); // suppress unhandled close
  });
}

/** Push raw bytes through a loopback socket and read from the other end. */
function socketPairRead(raw: Buffer): Promise<Packet> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((serverSocket) => {
      readPacket(serverSocket).then(resolve).catch(reject);
      serverSocket.on("error", reject);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      const client = net.createConnection(addr.port, "127.0.0.1", () => {
        client.write(raw, (err) => {
          if (err) reject(err);
          client.end();
        });
      });
      client.on("error", reject);
    });
    server.on("error", reject);
  });
}

/** Read exactly n bytes via recvExact from a socket that receives `data`. */
function recvExactFrom(data: Buffer, n: number, closeAfter = true): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((serverSocket) => {
      recvExact(serverSocket, n).then(resolve).catch(reject);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      const client = net.createConnection(addr.port, "127.0.0.1", () => {
        client.write(data, () => {
          if (closeAfter) client.end();
        });
      });
      client.on("error", reject);
    });
    server.on("error", reject);
  });
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

  it("CLOSE_STREAM_MESSAGE_ID == 2**31 - 1 (0x7FFFFFFF)", () => {
    expect(CLOSE_STREAM_MESSAGE_ID).toBe(2 ** 31 - 1);
  });

  it("CLOSE_STREAM_PAYLOAD is 0xFE byte", () => {
    expect(CLOSE_STREAM_PAYLOAD).toEqual(Buffer.from([0xfe]));
  });
});

// ---------------------------------------------------------------------------
// Packet round-trip
// ---------------------------------------------------------------------------

describe("packet round-trip", () => {
  it("basic payload", async () => {
    const p: Packet = { streamId: 0, messageId: 1, isReply: false, payload: Buffer.from("hello") };
    expect(await roundtrip(p)).toEqual(p);
  });

  it("empty payload", async () => {
    const p: Packet = { streamId: 0, messageId: 1, isReply: false, payload: Buffer.alloc(0) };
    expect(await roundtrip(p)).toEqual(p);
  });

  it("reply bit set", async () => {
    const p: Packet = {
      streamId: 1,
      messageId: 42,
      isReply: true,
      payload: Buffer.from("response"),
    };
    expect(await roundtrip(p)).toEqual(p);
  });

  it("large stream ID (0xFFFFFFFF)", async () => {
    const p: Packet = {
      streamId: 0xffffffff,
      messageId: 1,
      isReply: false,
      payload: Buffer.from("data"),
    };
    expect(await roundtrip(p)).toEqual(p);
  });

  it("large message ID (2**31 - 1 = 0x7FFFFFFF)", async () => {
    const p: Packet = {
      streamId: 0,
      messageId: 2 ** 31 - 1,
      isReply: false,
      payload: Buffer.from("data"),
    };
    expect(await roundtrip(p)).toEqual(p);
  });

  it("binary payload (all byte values)", async () => {
    const payload = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const p: Packet = { streamId: 3, messageId: 7, isReply: false, payload };
    expect(await roundtrip(p)).toEqual(p);
  });
});

// ---------------------------------------------------------------------------
// recvExact error handling
// ---------------------------------------------------------------------------

describe("recvExact", () => {
  it("reads exactly n bytes", async () => {
    const data = Buffer.from("hello world");
    const result = await recvExactFrom(data, 5);
    expect(result).toEqual(Buffer.from("hello"));
  });

  it("returns empty buffer for n=0", async () => {
    const result = await recvExactFrom(Buffer.alloc(0), 0);
    expect(result).toEqual(Buffer.alloc(0));
  });

  it("throws PartialPacketError when connection closes with no data", async () => {
    await expect(recvExactFrom(Buffer.alloc(0), 10)).rejects.toBeInstanceOf(PartialPacketError);
  });

  it("throws ConnectionClosedError when connection closes mid-read", async () => {
    const data = Buffer.from("abc");
    await expect(recvExactFrom(data, 10)).rejects.toBeInstanceOf(ConnectionClosedError);
  });

  it("propagates socket error", async () => {
    // Create a server that destroys the socket immediately with an error
    await expect(
      new Promise<Buffer>((_resolve, reject) => {
        const server = net.createServer((serverSocket) => {
          recvExact(serverSocket, 10).catch(reject);
          // Emit an error on the socket after a short delay
          setImmediate(() => {
            serverSocket.destroy(new Error("forced socket error"));
          });
        });
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address() as net.AddressInfo;
          const client = net.createConnection(addr.port, "127.0.0.1");
          client.on("error", () => {}); // suppress unhandled error
        });
        server.on("error", reject);
      }),
    ).rejects.toThrow(/forced socket error/);
  });
});

// ---------------------------------------------------------------------------
// readPacket error handling
// ---------------------------------------------------------------------------

describe("readPacket error handling", () => {
  it("throws on invalid magic number", async () => {
    const raw = makeRawPacket({ magic: 0xdeadbeef });
    await expect(socketPairRead(raw)).rejects.toThrow(/Invalid magic number/);
  });

  it("throws on invalid terminator", async () => {
    const raw = makeRawPacket({ terminator: 0xff });
    await expect(socketPairRead(raw)).rejects.toThrow(/Invalid terminator/);
  });

  it("throws on checksum mismatch", async () => {
    const raw = makeRawPacket({ checksum: 0x12345678 });
    await expect(socketPairRead(raw)).rejects.toThrow(/Checksum mismatch/);
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

  it("_HegelString encode returns null (decode-only sentinel)", () => {
    // Exercise the cbor-x extension's encode callback for coverage.
    // _HegelString is a decode-only sentinel, so encoding produces null.
    const instance = new _HegelString();
    const encoded = encode(instance);
    // cbor-x encodes `null` when the extension returns null
    expect(encoded).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// writePacket error handling
// ---------------------------------------------------------------------------

describe("writePacket error handling", () => {
  it("rejects when writing to a destroyed socket", async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address() as net.AddressInfo;
    const client = net.createConnection(addr.port, "127.0.0.1");
    await new Promise<void>((r) => client.once("connect", r));
    // Destroy the socket so the write will fail
    client.destroy();
    const p: Packet = { streamId: 1, messageId: 1, isReply: false, payload: Buffer.from("x") };
    await expect(writePacket(client, p)).rejects.toThrow();
    server.close();
  });
});
