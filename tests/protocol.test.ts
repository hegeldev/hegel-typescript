import { describe, it, expect } from "vitest";
import * as net from "net";
import { encode as cborEncode } from "cbor2";
import {
  MAGIC,
  REPLY_BIT,
  TERMINATOR,
  CLOSE_CHANNEL_MESSAGE_ID,
  CLOSE_CHANNEL_PAYLOAD,
  HEADER_SIZE,
  Packet,
  PartialPacket,
  readPacket,
  writePacket,
  recvExact,
  extractInt,
  extractFloat,
  extractString,
  extractBool,
  extractBytes,
  extractList,
  extractDict,
} from "../src/protocol.js";

// ---------------------------------------------------------------------------
// Socket pair helper
// ---------------------------------------------------------------------------

/**
 * Create a pair of connected TCP sockets [serverSide, clientSide].
 * We spin up a temporary server, connect a client, wait for the server to
 * accept, then close the server and return both ends.
 */
function makeSocketPair(): Promise<[net.Socket, net.Socket]> {
  return new Promise((resolve, reject) => {
    let serverConn: net.Socket | null = null;
    let clientConn: net.Socket | null = null;

    function tryResolve(): void {
      if (serverConn !== null && clientConn !== null) {
        resolve([serverConn, clientConn]);
      }
    }

    const server = net.createServer((conn) => {
      serverConn = conn;
      server.close();
      tryResolve();
    });

    server.on("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      const client = net.createConnection(addr.port, "127.0.0.1");
      client.on("error", reject);
      client.on("connect", () => {
        clientConn = client;
        tryResolve();
      });
    });
  });
}

function closeAll(...sockets: net.Socket[]): void {
  for (const s of sockets) {
    s.destroy();
  }
}

// ---------------------------------------------------------------------------
// Minimal CRC32 using Node.js built-in zlib (available since Node 22)
// ---------------------------------------------------------------------------

function crc32(data: Buffer): number {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zlib = require("zlib") as { crc32: (data: Buffer) => number };
  return zlib.crc32(data) >>> 0;
}

// ---------------------------------------------------------------------------
// Helper: manually build a raw packet buffer (mirrors Python's _make_packet)
// ---------------------------------------------------------------------------

function makeRawPacket(opts: {
  magic?: number;
  checksum?: number | null;
  channelId?: number;
  messageId?: number;
  payload?: Buffer;
  terminator?: number;
}): Buffer {
  const magic = opts.magic ?? MAGIC;
  const channelId = opts.channelId ?? 0;
  const messageId = opts.messageId ?? 1;
  const payload = opts.payload ?? Buffer.from("payload");
  const terminator = opts.terminator ?? TERMINATOR;
  const length = payload.length;

  // Build header with zeroed checksum to compute CRC
  const headerForCheck = Buffer.allocUnsafe(HEADER_SIZE);
  headerForCheck.writeUInt32BE(magic, 0);
  headerForCheck.writeUInt32BE(0, 4);
  headerForCheck.writeUInt32BE(channelId, 8);
  headerForCheck.writeUInt32BE(messageId, 12);
  headerForCheck.writeUInt32BE(length, 16);

  const computedCrc = crc32(Buffer.concat([headerForCheck, payload]));
  const checksum = opts.checksum ?? computedCrc;

  const header = Buffer.allocUnsafe(HEADER_SIZE);
  header.writeUInt32BE(magic, 0);
  header.writeUInt32BE(checksum >>> 0, 4);
  header.writeUInt32BE(channelId, 8);
  header.writeUInt32BE(messageId, 12);
  header.writeUInt32BE(length, 16);

  return Buffer.concat([header, payload, Buffer.from([terminator])]);
}

// ---------------------------------------------------------------------------
// Helper: write a packet then read it back
// ---------------------------------------------------------------------------

async function roundtrip(packet: Packet): Promise<Packet> {
  const [reader, writer] = await makeSocketPair();
  try {
    await writePacket(writer, packet);
    return await readPacket(reader);
  } finally {
    closeAll(reader, writer);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("MAGIC == 0x4845474C", () => {
    expect(MAGIC).toBe(0x4845474c);
  });

  it("REPLY_BIT == 1 << 31", () => {
    // 2**31 = 2147483648 = 0x80000000 (same bit pattern as 1 << 31 in Python)
    expect(REPLY_BIT).toBe(2 ** 31);
  });

  it("TERMINATOR == 0x0A", () => {
    expect(TERMINATOR).toBe(0x0a);
  });

  it("CLOSE_CHANNEL_MESSAGE_ID == (1 << 31) - 1", () => {
    // 2**31 - 1 = 2147483647 = 0x7FFFFFFF
    expect(CLOSE_CHANNEL_MESSAGE_ID).toBe(2 ** 31 - 1);
  });

  it("CLOSE_CHANNEL_PAYLOAD is 0xFE byte", () => {
    expect(CLOSE_CHANNEL_PAYLOAD).toEqual(Buffer.from([0xfe]));
  });
});

// ---------------------------------------------------------------------------
// Packet round-trip tests
// ---------------------------------------------------------------------------

describe("packet round-trip", () => {
  it("basic packet", async () => {
    const packet: Packet = {
      channelId: 0,
      messageId: 1,
      isReply: false,
      payload: Buffer.from("hello"),
    };
    expect(await roundtrip(packet)).toEqual(packet);
  });

  it("empty payload", async () => {
    const packet: Packet = {
      channelId: 0,
      messageId: 1,
      isReply: false,
      payload: Buffer.alloc(0),
    };
    expect(await roundtrip(packet)).toEqual(packet);
  });

  it("reply packet", async () => {
    const packet: Packet = {
      channelId: 1,
      messageId: 42,
      isReply: true,
      payload: Buffer.from("response"),
    };
    expect(await roundtrip(packet)).toEqual(packet);
  });

  it("large channel ID (0xFFFFFFFF)", async () => {
    const packet: Packet = {
      channelId: 0xffffffff,
      messageId: 1,
      isReply: false,
      payload: Buffer.from("data"),
    };
    expect(await roundtrip(packet)).toEqual(packet);
  });

  it("large message ID ((1 << 31) - 1)", async () => {
    const packet: Packet = {
      channelId: 0,
      messageId: 2 ** 31 - 1,
      isReply: false,
      payload: Buffer.from("data"),
    };
    expect(await roundtrip(packet)).toEqual(packet);
  });

  it("binary payload (all bytes 0-255)", async () => {
    const payload = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const packet: Packet = {
      channelId: 3,
      messageId: 7,
      isReply: false,
      payload,
    };
    expect(await roundtrip(packet)).toEqual(packet);
  });
});

// ---------------------------------------------------------------------------
// recvExact error cases
// ---------------------------------------------------------------------------

describe("recvExact", () => {
  it("throws ConnectionError when closed with partial data", async () => {
    const [reader, writer] = await makeSocketPair();
    try {
      writer.write(Buffer.from("abc"));
      // Let the data arrive, then tear down the writer
      await new Promise<void>((res) => setTimeout(res, 30));
      writer.destroy();
      await expect(recvExact(reader, 10)).rejects.toThrow(
        "Connection closed while reading",
      );
    } finally {
      closeAll(reader, writer);
    }
  }, 10_000);

  it("throws PartialPacket when closed with no data", async () => {
    const [reader, writer] = await makeSocketPair();
    try {
      writer.destroy();
      await expect(recvExact(reader, 10)).rejects.toBeInstanceOf(PartialPacket);
    } finally {
      closeAll(reader);
    }
  }, 10_000);

  it("returns empty buffer for n=0", async () => {
    const [reader, writer] = await makeSocketPair();
    try {
      const result = await recvExact(reader, 0);
      expect(result.length).toBe(0);
    } finally {
      closeAll(reader, writer);
    }
  });

  it("propagates socket errors via onError handler", async () => {
    const [reader, writer] = await makeSocketPair();
    try {
      // Start recvExact waiting for data that won't arrive
      const promise = recvExact(reader, 10);
      // Destroy the reader socket with an error to trigger the error path
      reader.destroy(new Error("test socket error"));
      await expect(promise).rejects.toThrow("test socket error");
    } finally {
      closeAll(reader, writer);
    }
  }, 10_000);

  it("throws ConnectionError via onClose when partial data then clean close", async () => {
    const [reader, writer] = await makeSocketPair();
    try {
      // Start waiting before any data arrives
      const promise = recvExact(reader, 10);
      // Write partial data then cleanly close (FIN, not RST) to trigger onClose
      writer.write(Buffer.from("abc"));
      writer.end();
      await expect(promise).rejects.toThrow("Connection closed while reading");
    } finally {
      closeAll(reader);
    }
  }, 10_000);
});

// ---------------------------------------------------------------------------
// writePacket error cases
// ---------------------------------------------------------------------------

describe("writePacket", () => {
  it("propagates write errors when socket is destroyed", async () => {
    const [reader, writer] = await makeSocketPair();
    try {
      writer.destroy();
      // Give the destruction a moment to take effect
      await new Promise<void>((res) => setTimeout(res, 10));
      const packet: Packet = {
        channelId: 0,
        messageId: 1,
        isReply: false,
        payload: Buffer.from("test"),
      };
      await expect(writePacket(writer, packet)).rejects.toThrow();
    } finally {
      closeAll(reader, writer);
    }
  }, 10_000);
});

// ---------------------------------------------------------------------------
// readPacket validation error cases
// ---------------------------------------------------------------------------

describe("readPacket validation", () => {
  it("throws on invalid magic number", async () => {
    const [reader, writer] = await makeSocketPair();
    try {
      writer.write(makeRawPacket({ magic: 0xdeadbeef }));
      await expect(readPacket(reader)).rejects.toThrow("Invalid magic number");
    } finally {
      closeAll(reader, writer);
    }
  });

  it("throws on invalid terminator", async () => {
    const [reader, writer] = await makeSocketPair();
    try {
      writer.write(makeRawPacket({ terminator: 0xff }));
      await expect(readPacket(reader)).rejects.toThrow("Invalid terminator");
    } finally {
      closeAll(reader, writer);
    }
  });

  it("throws on bad checksum", async () => {
    const [reader, writer] = await makeSocketPair();
    try {
      writer.write(makeRawPacket({ checksum: 0x12345678 }));
      await expect(readPacket(reader)).rejects.toThrow("Checksum mismatch");
    } finally {
      closeAll(reader, writer);
    }
  });
});

// ---------------------------------------------------------------------------
// CRC32 verification
// ---------------------------------------------------------------------------

describe("CRC32", () => {
  it("empty buffer yields known CRC", () => {
    expect(crc32(Buffer.alloc(0))).toBe(0x00000000);
  });

  it("known test vector: '123456789'", () => {
    // Standard CRC32 of ASCII '123456789' is 0xCBF43926
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("corrupted packet is detected", async () => {
    const [reader, writer] = await makeSocketPair();
    try {
      const raw = makeRawPacket({ payload: Buffer.from("hello") });
      raw[HEADER_SIZE] ^= 0xff; // corrupt first byte of payload
      writer.write(raw);
      await expect(readPacket(reader)).rejects.toThrow("Checksum mismatch");
    } finally {
      closeAll(reader, writer);
    }
  });
});

// ---------------------------------------------------------------------------
// CBOR round-trip via packet
// ---------------------------------------------------------------------------

describe("CBOR round-trip via packet", () => {
  async function cborRoundtrip(value: unknown): Promise<Packet> {
    const payload = Buffer.from(cborEncode(value));
    const packet: Packet = {
      channelId: 1,
      messageId: 2,
      isReply: false,
      payload,
    };
    return roundtrip(packet);
  }

  it("integer payload survives round-trip", async () => {
    const rt = await cborRoundtrip(42);
    expect(rt.payload).toEqual(Buffer.from(cborEncode(42)));
  });

  it("string payload survives round-trip", async () => {
    const rt = await cborRoundtrip("hello");
    expect(rt.payload).toEqual(Buffer.from(cborEncode("hello")));
  });

  it("boolean payload survives round-trip", async () => {
    const rt = await cborRoundtrip(true);
    expect(rt.payload).toEqual(Buffer.from(cborEncode(true)));
  });

  it("null payload survives round-trip", async () => {
    const rt = await cborRoundtrip(null);
    expect(rt.payload).toEqual(Buffer.from(cborEncode(null)));
  });

  it("float payload survives round-trip", async () => {
    const rt = await cborRoundtrip(3.14);
    expect(rt.payload).toEqual(Buffer.from(cborEncode(3.14)));
  });

  it("bytes payload survives round-trip", async () => {
    const rt = await cborRoundtrip(new Uint8Array([1, 2, 3]));
    expect(rt.payload).toEqual(
      Buffer.from(cborEncode(new Uint8Array([1, 2, 3]))),
    );
  });

  it("list payload survives round-trip", async () => {
    const rt = await cborRoundtrip([1, 2, 3]);
    expect(rt.payload).toEqual(Buffer.from(cborEncode([1, 2, 3])));
  });

  it("dict payload survives round-trip", async () => {
    const rt = await cborRoundtrip({ a: 1, b: "x" });
    expect(rt.payload).toEqual(Buffer.from(cborEncode({ a: 1, b: "x" })));
  });

  it("nested structure survives round-trip", async () => {
    const val = { items: [{ id: 1 }, { id: 2 }] };
    const rt = await cborRoundtrip(val);
    expect(rt.payload).toEqual(Buffer.from(cborEncode(val)));
  });
});

// ---------------------------------------------------------------------------
// CBOR extractor helpers
// ---------------------------------------------------------------------------

describe("extractInt", () => {
  it("returns number for integer", () => {
    expect(extractInt(42)).toBe(42);
    expect(extractInt(-1)).toBe(-1);
    expect(extractInt(0)).toBe(0);
  });

  it("throws for non-integer", () => {
    expect(() => extractInt("hello")).toThrow(/expected int.*got string/i);
    expect(() => extractInt(3.14)).toThrow(/expected int.*got number/i);
    expect(() => extractInt(null)).toThrow(/expected int/i);
  });
});

describe("extractFloat", () => {
  it("returns number for float", () => {
    expect(extractFloat(3.14)).toBeCloseTo(3.14);
  });

  it("also accepts integers (numeric)", () => {
    expect(extractFloat(42)).toBe(42);
  });

  it("throws for non-number", () => {
    expect(() => extractFloat("hi")).toThrow(/expected float.*got string/i);
    expect(() => extractFloat(null)).toThrow(/expected float/i);
  });
});

describe("extractString", () => {
  it("returns string value", () => {
    expect(extractString("hello")).toBe("hello");
    expect(extractString("")).toBe("");
  });

  it("throws for non-string", () => {
    expect(() => extractString(42)).toThrow(/expected string.*got number/i);
    expect(() => extractString(null)).toThrow(/expected string/i);
    expect(() => extractString(true)).toThrow(/expected string.*got boolean/i);
  });
});

describe("extractBool", () => {
  it("returns boolean value", () => {
    expect(extractBool(true)).toBe(true);
    expect(extractBool(false)).toBe(false);
  });

  it("throws for non-boolean", () => {
    expect(() => extractBool(1)).toThrow(/expected bool.*got number/i);
    expect(() => extractBool(null)).toThrow(/expected bool/i);
    expect(() => extractBool("true")).toThrow(/expected bool.*got string/i);
  });
});

describe("extractBytes", () => {
  it("returns Uint8Array", () => {
    const b = new Uint8Array([1, 2, 3]);
    expect(extractBytes(b)).toEqual(b);
  });

  it("throws for non-bytes", () => {
    expect(() => extractBytes("hello")).toThrow(/expected bytes.*got string/i);
    expect(() => extractBytes(null)).toThrow(/expected bytes/i);
    expect(() => extractBytes([1, 2])).toThrow(/expected bytes.*got array/i);
  });
});

describe("extractList", () => {
  it("returns array", () => {
    expect(extractList([1, 2, 3])).toEqual([1, 2, 3]);
    expect(extractList([])).toEqual([]);
  });

  it("throws for non-array", () => {
    expect(() => extractList("hello")).toThrow(/expected list.*got string/i);
    expect(() => extractList(null)).toThrow(/expected list/i);
    expect(() => extractList({ a: 1 })).toThrow(/expected list.*got object/i);
  });
});

describe("extractDict", () => {
  it("returns plain object", () => {
    expect(extractDict({ a: 1 })).toEqual({ a: 1 });
    expect(extractDict({})).toEqual({});
  });

  it("throws for non-object", () => {
    expect(() => extractDict("hello")).toThrow(/expected dict.*got string/i);
    expect(() => extractDict(null)).toThrow(/expected dict/i);
    expect(() => extractDict([1, 2])).toThrow(/expected dict.*got array/i);
    expect(() => extractDict(42)).toThrow(/expected dict.*got number/i);
  });
});
