import { createRequire } from "module";
import * as net from "net";
import { describe, it, expect } from "vitest";
import {
  MAGIC,
  REPLY_BIT,
  TERMINATOR,
  CLOSE_CHANNEL_MESSAGE_ID,
  CLOSE_CHANNEL_PAYLOAD,
  Packet,
  readPacket,
  writePacket,
  recvExact,
  PartialPacketError,
  ConnectionClosedError,
  encodeValue,
  decodeValue,
  extractInt,
  extractFloat,
  extractString,
  extractBool,
  extractBytes,
  extractList,
  extractDict,
} from "../src/protocol.js";

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
  channelId = 0,
  messageId = 1,
  payload = Buffer.from("payload"),
  terminator = TERMINATOR,
}: {
  magic?: number;
  checksum?: number;
  channelId?: number;
  messageId?: number;
  payload?: Buffer;
  terminator?: number;
} = {}): Buffer {
  const headerForCheck = Buffer.alloc(20);
  headerForCheck.writeUInt32BE(magic, 0);
  headerForCheck.writeUInt32BE(0, 4); // checksum field zeroed
  headerForCheck.writeUInt32BE(channelId, 8);
  headerForCheck.writeUInt32BE(messageId, 12);
  headerForCheck.writeUInt32BE(payload.length, 16);

  const crc = checksum ?? crc32(Buffer.concat([headerForCheck, payload]));

  const header = Buffer.alloc(20);
  header.writeUInt32BE(magic, 0);
  header.writeUInt32BE(crc, 4);
  header.writeUInt32BE(channelId, 8);
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

  it("CLOSE_CHANNEL_MESSAGE_ID == 2**31 - 1 (0x7FFFFFFF)", () => {
    expect(CLOSE_CHANNEL_MESSAGE_ID).toBe(2 ** 31 - 1);
  });

  it("CLOSE_CHANNEL_PAYLOAD is 0xFE byte", () => {
    expect(CLOSE_CHANNEL_PAYLOAD).toEqual(Buffer.from([0xfe]));
  });
});

// ---------------------------------------------------------------------------
// Packet round-trip
// ---------------------------------------------------------------------------

describe("packet round-trip", () => {
  it("basic payload", async () => {
    const p: Packet = { channelId: 0, messageId: 1, isReply: false, payload: Buffer.from("hello") };
    expect(await roundtrip(p)).toEqual(p);
  });

  it("empty payload", async () => {
    const p: Packet = { channelId: 0, messageId: 1, isReply: false, payload: Buffer.alloc(0) };
    expect(await roundtrip(p)).toEqual(p);
  });

  it("reply bit set", async () => {
    const p: Packet = {
      channelId: 1,
      messageId: 42,
      isReply: true,
      payload: Buffer.from("response"),
    };
    expect(await roundtrip(p)).toEqual(p);
  });

  it("large channel ID (0xFFFFFFFF)", async () => {
    const p: Packet = {
      channelId: 0xffffffff,
      messageId: 1,
      isReply: false,
      payload: Buffer.from("data"),
    };
    expect(await roundtrip(p)).toEqual(p);
  });

  it("large message ID (2**31 - 1 = 0x7FFFFFFF)", async () => {
    const p: Packet = {
      channelId: 0,
      messageId: 2 ** 31 - 1,
      isReply: false,
      payload: Buffer.from("data"),
    };
    expect(await roundtrip(p)).toEqual(p);
  });

  it("binary payload (all byte values)", async () => {
    const payload = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const p: Packet = { channelId: 3, messageId: 7, isReply: false, payload };
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

  it("ignores timeout when mid-packet (received > 0)", async () => {
    // Cover the onTimeout branch where received > 0: timeout fires but recvExact
    // should ignore it and continue waiting for more data.
    //
    // Strategy: intercept socket.read() to split one logical read into two calls.
    // On the first call, we eagerly read ALL available bytes but only return the
    // first half, stashing the rest in a local buffer. This forces recvExact to
    // see received=5 after tryRead() exits. We then emit a fake 'timeout' as a
    // microtask (received=5>0 → ignored), then emit 'readable' so recvExact runs
    // tryRead() again and drains the stashed bytes.
    const result = await new Promise<Buffer>((resolve, reject) => {
      const server = net.createServer((serverSocket) => {
        let stash: Buffer | null = null;
        let state: "initial" | "stashed" | "done" = "initial";
        const origRead = serverSocket.read.bind(serverSocket);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (serverSocket as any).read = function (size?: number): Buffer | null {
          if (state === "stashed") {
            // Second call within same tryRead() loop — return null so the loop
            // exits with received=5. The stash will be served on the next call
            // after we re-emit 'readable'.
            return null;
          }
          if (state === "draining") {
            // Called from the re-emitted 'readable' event — return the stash.
            const s = stash!;
            stash = null;
            state = "done";
            return s;
          }
          if (state === "initial") {
            // Read everything available.
            const all = origRead(size) as Buffer | null;
            if (all === null) return null;
            if (all.length > 1) {
              // Split: return first half now, stash the rest.
              const half = Math.floor(all.length / 2);
              stash = all.subarray(half);
              state = "stashed";
              // After tryRead() exits with received=5 (the first half),
              // emit timeout (received=5>0 → ignored), then re-emit 'readable'
              // so recvExact calls tryRead() again to drain the stash.
              Promise.resolve()
                .then(() => {
                  state = "draining";
                  serverSocket.emit("timeout");
                })
                .then(() => {
                  serverSocket.emit("readable");
                });
              return all.subarray(0, half);
            }
            state = "done";
            return all;
          }
          return origRead(size) as Buffer | null;
        };

        recvExact(serverSocket, 10).then(resolve).catch(reject);
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as net.AddressInfo;
        const client = net.createConnection(addr.port, "127.0.0.1", () => {
          // Write all 10 bytes at once so they arrive as a single chunk.
          client.write(Buffer.from("helloworld"));
        });
        client.on("error", reject);
      });
      server.on("error", reject);
    });
    expect(result).toEqual(Buffer.from("helloworld"));
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
});

// ---------------------------------------------------------------------------
// CBOR extractor helpers — correct type
// ---------------------------------------------------------------------------

describe("CBOR extractors — correct type", () => {
  it("extractInt returns integer", () => {
    expect(extractInt(42, "field")).toBe(42);
  });

  it("extractFloat returns float", () => {
    expect(extractFloat(3.14, "field")).toBeCloseTo(3.14);
  });

  it("extractFloat accepts integer (promoted to float)", () => {
    expect(extractFloat(1, "field")).toBe(1);
  });

  it("extractString returns string", () => {
    expect(extractString("hello", "field")).toBe("hello");
  });

  it("extractBool returns boolean", () => {
    expect(extractBool(true, "field")).toBe(true);
    expect(extractBool(false, "field")).toBe(false);
  });

  it("extractBytes returns Buffer", () => {
    const buf = Buffer.from([1, 2, 3]);
    expect(extractBytes(buf, "field")).toEqual(buf);
  });

  it("extractList returns array", () => {
    expect(extractList([1, 2, 3], "field")).toEqual([1, 2, 3]);
  });

  it("extractDict returns object", () => {
    expect(extractDict({ a: 1 }, "field")).toEqual({ a: 1 });
  });
});

// ---------------------------------------------------------------------------
// CBOR extractor helpers — wrong type raises clear error
// ---------------------------------------------------------------------------

describe("CBOR extractors — wrong type", () => {
  it("extractInt rejects string", () => {
    expect(() => extractInt("oops", "myField")).toThrow(/myField.*string/);
  });

  it("extractInt rejects float", () => {
    expect(() => extractInt(1.5, "myField")).toThrow(/myField/);
  });

  it("extractFloat rejects string", () => {
    expect(() => extractFloat("oops", "myField")).toThrow(/myField.*string/);
  });

  it("extractString rejects integer", () => {
    expect(() => extractString(42, "myField")).toThrow(/myField.*number/);
  });

  it("extractBool rejects string", () => {
    expect(() => extractBool("true", "myField")).toThrow(/myField.*string/);
  });

  it("extractBytes rejects string", () => {
    expect(() => extractBytes("oops", "myField")).toThrow(/myField.*string/);
  });

  it("extractList rejects object", () => {
    expect(() => extractList({ a: 1 }, "myField")).toThrow(/myField.*object/);
  });

  it("extractDict rejects array", () => {
    expect(() => extractDict([1, 2], "myField")).toThrow(/myField.*array/);
  });

  it("extractDict rejects null", () => {
    expect(() => extractDict(null, "myField")).toThrow(/myField.*null/);
  });

  it("extractInt rejects null", () => {
    expect(() => extractInt(null, "myField")).toThrow(/myField.*null/);
  });

  it("extractDict rejects non-object primitive (number)", () => {
    expect(() => extractDict(42, "myField")).toThrow(/myField.*number/);
  });

  // Null branches in extractors that accept non-null wrong types above
  it("extractString rejects null", () => {
    expect(() => extractString(null, "myField")).toThrow(/myField.*null/);
  });

  it("extractBool rejects null", () => {
    expect(() => extractBool(null, "myField")).toThrow(/myField.*null/);
  });

  it("extractList rejects null", () => {
    expect(() => extractList(null, "myField")).toThrow(/myField.*null/);
  });

  it("extractBytes rejects null", () => {
    expect(() => extractBytes(null, "myField")).toThrow(/myField.*null/);
  });

  it("extractBytes accepts Uint8Array", () => {
    const arr = new Uint8Array([1, 2, 3]);
    expect(extractBytes(arr, "myField")).toEqual(Buffer.from([1, 2, 3]));
  });

  it("extractFloat rejects null", () => {
    expect(() => extractFloat(null, "myField")).toThrow(/myField.*null/);
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
    const p: Packet = { channelId: 1, messageId: 1, isReply: false, payload: Buffer.from("x") };
    await expect(writePacket(client, p)).rejects.toThrow();
    server.close();
  });
});
