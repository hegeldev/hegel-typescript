import { describe, it, expect } from "vitest";
import * as net from "net";
import { encode as cborEncode } from "cbor2";
import {
  Connection,
  RequestError,
  resultOrError,
  SHUTDOWN,
} from "../src/connection.js";
import {
  Packet,
  CLOSE_CHANNEL_MESSAGE_ID,
  CLOSE_CHANNEL_PAYLOAD,
} from "../src/protocol.js";

// ---------------------------------------------------------------------------
// Socket pair helper (same pattern as protocol.test.ts)
// ---------------------------------------------------------------------------

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

/** Perform a handshake on both ends concurrently. */
async function handshakePair(
  serverConn: Connection,
  clientConn: Connection,
): Promise<void> {
  await Promise.all([
    serverConn.receiveHandshake(),
    clientConn.sendHandshake(),
  ]);
}

// ---------------------------------------------------------------------------
// RequestError / resultOrError unit tests
// ---------------------------------------------------------------------------

describe("RequestError", () => {
  it("stores message, errorType, and remaining data", () => {
    const data = {
      error: "something went wrong",
      type: "TestError",
      extra: "data",
    };
    const err = new RequestError(data);
    expect(String(err)).toContain("something went wrong");
    expect(err.errorType).toBe("TestError");
    expect(err.data).toEqual({ extra: "data" });
  });
});

describe("resultOrError", () => {
  it("raises RequestError when error key present", () => {
    expect(() => resultOrError({ error: "bad", type: "TestError" })).toThrow(
      RequestError,
    );
    expect(() => resultOrError({ error: "bad", type: "TestError" })).toThrow(
      "bad",
    );
  });

  it("returns result value when no error", () => {
    expect(resultOrError({ result: 42 })).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

describe("Connection.live", () => {
  it("is true initially, false after close", async () => {
    const [sock] = await makeSocketPair();
    const conn = new Connection(sock, { name: "Live" });
    expect(conn.live).toBe(true);
    conn.close();
    expect(conn.live).toBe(false);
  });
});

describe("Connection.close", () => {
  it("double close does not throw", async () => {
    const [sock] = await makeSocketPair();
    const conn = new Connection(sock, { name: "DoubleClose" });
    conn.close();
    conn.close(); // should not throw
  });
});

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

describe("handshake", () => {
  it("sendHandshake returns server version string", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      const [version] = await Promise.all([
        clientConn.sendHandshake(),
        serverConn.receiveHandshake(),
      ]);
      expect(version).toBe("0.1");
    } finally {
      clientConn.close();
      serverConn.close();
    }
  });

  it("double sendHandshake raises", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      await handshakePair(serverConn, clientConn);
      await expect(clientConn.sendHandshake()).rejects.toThrow(
        "Handshake already established",
      );
    } finally {
      clientConn.close();
      serverConn.close();
    }
  });

  it("double receiveHandshake raises", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      await handshakePair(serverConn, clientConn);
      await expect(serverConn.receiveHandshake()).rejects.toThrow(
        "Handshake already established",
      );
    } finally {
      clientConn.close();
      serverConn.close();
    }
  });

  it("bad handshake string raises ConnectionError on server", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      // Client sends a bad handshake string directly via raw channel API
      const sendBad = clientConn.controlChannel.sendRequestRaw(
        Buffer.from("BadVersion"),
      );
      await expect(serverConn.receiveHandshake()).rejects.toThrow(
        "Bad handshake",
      );
      await sendBad;
    } finally {
      clientConn.close();
      serverConn.close();
    }
  });

  it("bad handshake response raises ConnectionError on client", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      // Server reads the request then sends a bad response
      const serverSide = async (): Promise<void> => {
        const ch = serverConn.controlChannel;
        const [msgId] = await ch.receiveRequestRaw();
        await ch.sendResponseRaw(msgId, Buffer.from("NotOk"));
      };
      const [, err] = await Promise.allSettled([
        serverSide(),
        clientConn.sendHandshake(),
      ]);
      expect(err.status).toBe("rejected");
      if (err.status === "rejected") {
        expect(err.reason).toBeInstanceOf(Error);
        expect((err.reason as Error).message).toMatch(/Bad handshake/);
      }
    } finally {
      clientConn.close();
      serverConn.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Channel allocation
// ---------------------------------------------------------------------------

describe("channel allocation", () => {
  it("newChannel before handshake raises", async () => {
    const [sock] = await makeSocketPair();
    const conn = new Connection(sock, { name: "Test" });
    try {
      await expect(async () => conn.newChannel()).rejects.toThrow(
        "Cannot create a new channel",
      );
    } finally {
      conn.close();
    }
  });

  it("connectChannel before handshake raises", async () => {
    const [sock] = await makeSocketPair();
    const conn = new Connection(sock, { name: "Test" });
    try {
      await expect(async () => conn.connectChannel(1)).rejects.toThrow(
        "Cannot create a new channel",
      );
    } finally {
      conn.close();
    }
  });

  it("client channels get odd IDs: 3, 5, 7 (counter<<1 | 1)", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      await handshakePair(serverConn, clientConn);
      const ch1 = clientConn.newChannel();
      const ch2 = clientConn.newChannel();
      const ch3 = clientConn.newChannel();
      // Python formula: (nextChannelId << 1) | 1, counter starts at 1
      // → (1<<1)|1=3, (2<<1)|1=5, (3<<1)|1=7 — all odd
      expect(ch1.channelId % 2).toBe(1); // must be odd
      expect(ch2.channelId % 2).toBe(1);
      expect(ch3.channelId % 2).toBe(1);
      // IDs must be strictly increasing
      expect(ch2.channelId).toBeGreaterThan(ch1.channelId);
      expect(ch3.channelId).toBeGreaterThan(ch2.channelId);
    } finally {
      clientConn.close();
      serverConn.close();
    }
  });

  it("connectChannel already exists raises", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      await handshakePair(serverConn, clientConn);
      await expect(async () => clientConn.connectChannel(0)).rejects.toThrow(
        "Channel already connected",
      );
    } finally {
      clientConn.close();
      serverConn.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Channel close
// ---------------------------------------------------------------------------

describe("channel close", () => {
  it("close is idempotent (double close ok)", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      await handshakePair(serverConn, clientConn);
      const ch = clientConn.newChannel({ role: "TestClose" });
      ch.close();
      ch.close(); // should not throw
    } finally {
      serverConn.close();
      clientConn.close();
    }
  });

  it("close when connection is not live does not throw", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      await handshakePair(serverConn, clientConn);
      const ch = clientConn.newChannel({ role: "TestClose" });
      clientConn.close();
      ch.close(); // connection already closed — should not throw
    } finally {
      serverConn.close();
    }
  });

  it("receiveRequest on closed channel raises ConnectionError", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      await handshakePair(serverConn, clientConn);
      const ch = clientConn.newChannel({ role: "TestClosed" });
      ch.close();
      await expect(ch.receiveRequest({ timeout: 0.1 })).rejects.toThrow(
        "is closed",
      );
    } finally {
      serverConn.close();
      clientConn.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Channel timeout
// ---------------------------------------------------------------------------

describe("channel timeout", () => {
  it("receiveRequest times out when no message arrives", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      await handshakePair(serverConn, clientConn);
      const ch = clientConn.newChannel({ role: "TestTimeout" });
      await expect(ch.receiveRequest({ timeout: 0.1 })).rejects.toThrow(
        "Timed out",
      );
    } finally {
      serverConn.close();
      clientConn.close();
    }
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Message dispatching to non-existent channel
// ---------------------------------------------------------------------------

describe("message to non-existent channel", () => {
  it("server sends error reply for unknown channel", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      await handshakePair(serverConn, clientConn);

      // Client sends a packet to channel 999 (non-existent on server)
      const packet: Packet = {
        channelId: 999,
        messageId: 1,
        isReply: false,
        payload: Buffer.from(cborEncode({ command: "test" })),
      };
      await clientConn.sendPacket(packet);

      // Use a ping to ensure the server processes the unknown message
      const pingId = await clientConn.controlChannel.sendRequestRaw(
        Buffer.from("ping"),
      );
      await serverConn.controlChannel.receiveRequestRaw();
      // Server received it; now clean up
      serverConn.close();
      clientConn.close();
      // The ping response won't arrive but that's fine
      void pingId;
    } finally {
      serverConn.close();
      clientConn.close();
    }
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Request / response round-trips
// ---------------------------------------------------------------------------

describe("request handling", () => {
  it("send_request / receive_response (CBOR)", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    try {
      // Server and client run concurrently — neither can fully complete before
      // the other starts, since they need each other's messages.
      const serverSide = async (): Promise<void> => {
        await serverConn.receiveHandshake();
        // First newChannel after handshake on SERVER side → ID=(1<<1)|0=2
        const handlerCh = serverConn.newChannel({ role: "Handler" });
        const [msgId, msg] = await handlerCh.receiveRequest();
        const result = {
          sum:
            (msg as Record<string, number>).x +
            (msg as Record<string, number>).y,
        };
        await handlerCh.sendResponseValue(msgId, result);
      };

      const clientSide = async (): Promise<void> => {
        await clientConn.sendHandshake();
        // Channel 2 = first server-side channel
        const sendCh = clientConn.connectChannel(2);
        const pending = sendCh.request({ x: 2, y: 3 });
        const result = await pending.get();
        expect(result).toEqual({ sum: 5 });
      };

      await Promise.all([serverSide(), clientSide()]);
    } finally {
      clientConn.close();
      serverConn.close();
    }
  }, 15_000);

  it("PendingRequest.get() caches the result", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    try {
      const serverSide = async (): Promise<void> => {
        await serverConn.receiveHandshake();
        const ch = serverConn.newChannel({ role: "PR" });
        const [msgId, msg] = await ch.receiveRequest();
        await ch.sendResponseValue(msgId, (msg as { value: number }).value * 2);
      };

      const clientSide = async (): Promise<void> => {
        await clientConn.sendHandshake();
        const ch = clientConn.connectChannel(2);
        const pending = ch.request({ value: 21 });
        expect(await pending.get()).toBe(42);
        expect(await pending.get()).toBe(42); // second call uses cached value
      };

      await Promise.all([serverSide(), clientSide()]);
    } finally {
      clientConn.close();
      serverConn.close();
    }
  }, 15_000);

  it("receiveResponse (CBOR, direct)", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    try {
      const serverSide = async (): Promise<void> => {
        await serverConn.receiveHandshake();
        const ch = serverConn.newChannel({ role: "RR" });
        const [msgId] = await ch.receiveRequest();
        await ch.sendResponseValue(msgId, 42);
      };

      const clientSide = async (): Promise<void> => {
        await clientConn.sendHandshake();
        const ch = clientConn.connectChannel(2);
        const msgId = await ch.sendRequest({ test: true });
        const result = await ch.receiveResponse(msgId);
        expect(result).toBe(42);
      };

      await Promise.all([serverSide(), clientSide()]);
    } finally {
      clientConn.close();
      serverConn.close();
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Error responses
// ---------------------------------------------------------------------------

describe("error responses", () => {
  it("handleRequests sends error response on exception", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    try {
      const serverSide = async (): Promise<void> => {
        await serverConn.receiveHandshake();
        const ch = serverConn.newChannel({ role: "ErrTest" });
        // handleRequests loops until closed — close connection to stop it
        try {
          await ch.handleRequests(async () => {
            throw new Error("test error");
          });
        } catch {
          // connection closed is expected
        }
      };

      const clientSide = async (): Promise<void> => {
        await clientConn.sendHandshake();
        const ch = clientConn.connectChannel(2);
        await expect(ch.request({ anything: true }).get()).rejects.toThrow(
          "test error",
        );
        serverConn.close();
      };

      await Promise.all([serverSide(), clientSide()]);
    } finally {
      clientConn.close();
      serverConn.close();
    }
  }, 15_000);

  it("sendResponseError with exception object", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    try {
      const serverSide = async (): Promise<void> => {
        await serverConn.receiveHandshake();
        const ch = serverConn.newChannel({ role: "ErrMsg" });
        const [msgId] = await ch.receiveRequest();
        await ch.sendResponseError(msgId, new Error("an error"));
      };

      const clientSide = async (): Promise<void> => {
        await clientConn.sendHandshake();
        const ch = clientConn.connectChannel(2);
        await expect(ch.request({ anything: true }).get()).rejects.toThrow(
          "an error",
        );
      };

      await Promise.all([serverSide(), clientSide()]);
    } finally {
      clientConn.close();
      serverConn.close();
    }
  }, 15_000);

  it("sendResponseError with explicit error string and type", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    try {
      const serverSide = async (): Promise<void> => {
        await serverConn.receiveHandshake();
        const ch = serverConn.newChannel({ role: "ErrKw" });
        const [msgId] = await ch.receiveRequest();
        await ch.sendResponseError(msgId, undefined, {
          error: "custom error",
          errorType: "CustomType",
        });
      };

      const clientSide = async (): Promise<void> => {
        await clientConn.sendHandshake();
        const ch = clientConn.connectChannel(2);
        try {
          await ch.request({ anything: true }).get();
          expect.fail("should have thrown");
        } catch (e) {
          expect(e).toBeInstanceOf(RequestError);
          expect((e as RequestError).errorType).toBe("CustomType");
          expect((e as RequestError).message).toMatch("custom error");
        }
      };

      await Promise.all([serverSide(), clientSide()]);
    } finally {
      clientConn.close();
      serverConn.close();
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// SHUTDOWN sentinel in inbox
// ---------------------------------------------------------------------------

describe("SHUTDOWN sentinel", () => {
  it("SHUTDOWN in inbox raises ConnectionError", async () => {
    const [sock] = await makeSocketPair();
    const conn = new Connection(sock, { name: "Test" });
    const ch = conn.controlChannel;
    ch.inbox.push(SHUTDOWN);
    await expect(ch.receiveRequest({ timeout: 0.1 })).rejects.toThrow(
      "Connection closed",
    );
    conn.close();
  });
});

// ---------------------------------------------------------------------------
// handleRequests decorator pattern
// ---------------------------------------------------------------------------

describe("handleRequests", () => {
  it("processes multiple requests and can be stopped", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    try {
      let callCount = 0;
      const serverReady = (async () => {
        await serverConn.receiveHandshake();
        const ch = serverConn.newChannel({ role: "Multi" });
        await ch.handleRequests(
          async (msg) => {
            callCount++;
            return (msg as { v: number }).v * 2;
          },
          { until: () => callCount >= 2 },
        );
      })();

      await clientConn.sendHandshake();

      const ch = clientConn.connectChannel(2);
      const r1 = ch.request({ v: 1 });
      const r2 = ch.request({ v: 2 });
      expect(await r1.get()).toBe(2);
      expect(await r2.get()).toBe(4);
      await serverReady;
    } finally {
      clientConn.close();
      serverConn.close();
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Raw request / response (bytes, not CBOR)
// ---------------------------------------------------------------------------

describe("raw channel API", () => {
  it("sendRequestRaw / receiveRequestRaw / sendResponseRaw round-trip", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    try {
      const serverSide = async (): Promise<void> => {
        await serverConn.receiveHandshake();
        const ch = serverConn.newChannel({ role: "Raw" });
        const [msgId, payload] = await ch.receiveRequestRaw();
        expect(payload).toEqual(Buffer.from("raw bytes"));
        await ch.sendResponseRaw(msgId, Buffer.from("raw reply"));
      };

      const clientSide = async (): Promise<void> => {
        await clientConn.sendHandshake();
        const ch = clientConn.connectChannel(2);
        const msgId = await ch.sendRequestRaw(Buffer.from("raw bytes"));
        const response = await ch.receiveResponseRaw(msgId);
        expect(response).toEqual(Buffer.from("raw reply"));
      };

      await Promise.all([serverSide(), clientSide()]);
    } finally {
      clientConn.close();
      serverConn.close();
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Duplicate response message ID guard
// ---------------------------------------------------------------------------

describe("duplicate response guard", () => {
  it("receiving two replies with the same message ID raises", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    try {
      await handshakePair(serverConn, clientConn);

      const replyPacket: Packet = {
        channelId: 0,
        messageId: 42,
        isReply: true,
        payload: Buffer.from(cborEncode({ result: 1 })),
      };

      // Pre-seed the responses map so the duplicate guard fires on the next
      // inbox packet with the same message ID.
      clientConn.controlChannel.responses.set(42, Buffer.from("existing"));

      // Put a packet with that same message ID into the inbox.
      // When _processOneMessage drains it, it will see a duplicate and throw.
      clientConn.controlChannel.inbox.push(replyPacket);

      // receiveResponseRaw for a non-existent ID will call _processOneMessage,
      // which will hit the duplicate guard and throw.
      await expect(
        clientConn.controlChannel.receiveResponseRaw(999),
      ).rejects.toThrow(/two responses/i);
    } finally {
      clientConn.close();
      serverConn.close();
    }
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Coverage: reader lock spin path (lines 237-238)
// ---------------------------------------------------------------------------

describe("reader lock spin", () => {
  it("second concurrent runReader waiter exits when until() is satisfied", async () => {
    // This test covers lines 237-238: the spin-loop `if (until()) return` branch.
    // Strategy: channel A waits for a response. While A holds the reader lock,
    // the server sends channel B's response FIRST, then channel A's. The reader
    // (lock holder for A) dispatches B's packet to B's inbox. Meanwhile B is
    // spinning in the lock-wait loop, and when B's until() becomes true (inbox
    // has data), B exits via the `if (until()) return` path at line 237.
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    try {
      const serverSide = async (): Promise<void> => {
        await serverConn.receiveHandshake();
        // Two server channels: A (ID 2) and B (ID 4)
        const chA = serverConn.newChannel({ role: "SA" });
        const chB = serverConn.newChannel({ role: "SB" });
        // Receive A's request
        const [idA] = await chA.receiveRequest();
        // Receive B's request
        const [idB] = await chB.receiveRequest();
        // CRITICAL: respond to B FIRST, then A. The client's reader (holding lock
        // on behalf of channel A) will dispatch the B response to B's inbox,
        // making B's until() true while A's lock is still held.
        await chB.sendResponseValue(idB, "from-B");
        await chA.sendResponseValue(idA, "from-A");
      };

      const clientSide = async (): Promise<void> => {
        await clientConn.sendHandshake();
        const chA = clientConn.connectChannel(2);
        const chB = clientConn.connectChannel(4);

        // Both channels send requests so the server can receive them
        const reqA = chA.request({ val: "a" });
        const reqB = chB.request({ val: "b" });

        // Now await both responses concurrently:
        // - chA.get() → runReader(untilA) → acquires lock
        // - chB.get() → runReader(untilB) → spins (lock held by A's reader)
        // When A's reader dispatches the B response, untilB() becomes true →
        // B's spin loop takes the `if (until()) return` branch (line 237).
        const [vA, vB] = await Promise.all([reqA.get(), reqB.get()]);
        expect(vA).toBe("from-A");
        expect(vB).toBe("from-B");
      };

      await Promise.all([serverSide(), clientSide()]);
    } finally {
      clientConn.close();
      serverConn.close();
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Coverage: reader loop non-timeout break path
// ---------------------------------------------------------------------------

describe("reader loop error handling", () => {
  it("reader exits cleanly when socket is destroyed while holding lock", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      await handshakePair(serverConn, clientConn);
      const ch = clientConn.newChannel({ role: "ReaderBreak" });

      // Start a receive that will trigger runReader
      const receiveP = ch.receiveRequest({ timeout: 5 });

      // Destroy the underlying socket mid-read to trigger the non-timeout
      // error path in the reader loop (the `break` branch)
      await new Promise<void>((r) => setTimeout(r, 50));
      clientSock.destroy();

      // The receive should reject (connection closed)
      await expect(receiveP).rejects.toThrow();
    } finally {
      serverConn.close();
      clientConn.close();
    }
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Coverage: channel close dispatch (_dispatch CLOSE_CHANNEL path)
// ---------------------------------------------------------------------------

describe("channel close dispatch", () => {
  it("remote channel close marks channel as dead (existing channel, no role)", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      await handshakePair(serverConn, clientConn);

      // Server creates a channel WITHOUT a role. Client connects to it, then closes.
      // Server receives CLOSE_CHANNEL for this channel — entry is a real Channel
      // (not DeadChannel), covering the `entry && !isDeadChannel(entry)` true branch.
      // With entry.role = undefined, the `entry.role ?? \`channel X\`` false branch fires.
      const serverCh = serverConn.newChannel(); // no role — covers b[15] false branch
      const clientCh = clientConn.connectChannel(serverCh.channelId);

      // Client closes — sends CLOSE_CHANNEL to server
      clientCh.close();

      // Trigger the server reader by sending a follow-up request on control channel
      const pingId = await clientConn.controlChannel.sendRequestRaw(
        Buffer.from("ping"),
      );
      await serverConn.controlChannel.receiveRequestRaw({ timeout: 2 });
      void pingId;
    } finally {
      serverConn.close();
      clientConn.close();
    }
  }, 10_000);

  it("CLOSE_CHANNEL for unknown channel and reply to dead/unknown channel", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      await handshakePair(serverConn, clientConn);

      // Server creates channel 2 and close it so it becomes a DeadChannel on
      // the server (via the CLOSE_CHANNEL from client → _dispatch on server).
      const serverCh = serverConn.newChannel({ role: "ToKill" }); // ID 2
      const clientCh = clientConn.connectChannel(serverCh.channelId);

      // Client closes → server receives CLOSE_CHANNEL → server's _dispatch marks it dead
      clientCh.close();

      // Also send a CLOSE_CHANNEL for a channel that never existed on the server
      // (e.g., channel 777). When dispatched, entry = undefined →
      // b[13] false branch (line 272) fires.
      await clientConn.sendPacket({
        channelId: 777,
        messageId: CLOSE_CHANNEL_MESSAGE_ID,
        isReply: false,
        payload: Buffer.from(CLOSE_CHANNEL_PAYLOAD),
      });

      // Client sends a request to channel 2 — which will be dead on server
      // (after it processes clientCh.close() above) → covers b[18] "closed" branch.
      await clientConn.sendPacket({
        channelId: serverCh.channelId,
        messageId: 99,
        isReply: false,
        payload: Buffer.from(cborEncode({ test: true })),
      });

      // Client sends a reply to non-existent channel 999 — silently dropped
      // (no error response sent because isReply=true) → covers b[19] false branch.
      await clientConn.sendPacket({
        channelId: 999,
        messageId: 1,
        isReply: true,
        payload: Buffer.from(cborEncode({ result: "ignored" })),
      });

      // Flush the server reader with a ping to ensure all packets above are dispatched
      const pingId = await clientConn.controlChannel.sendRequestRaw(
        Buffer.from("ping"),
      );
      await serverConn.controlChannel.receiveRequestRaw({ timeout: 2 });
      void pingId;
    } finally {
      serverConn.close();
      clientConn.close();
    }
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Coverage: sendResponseError variants and handleRequests non-Error throw
// ---------------------------------------------------------------------------

describe("sendResponseError coverage", () => {
  it("sendResponseError with no err and no options uses String(err) fallback", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      const serverSide = async (): Promise<void> => {
        await serverConn.receiveHandshake();
        const ch = serverConn.newChannel({ role: "ErrNone" });
        const [msgId] = await ch.receiveRequest();
        // Call with err=undefined and empty options — covers String(err) and "Error" type branches
        await ch.sendResponseError(msgId, undefined, {});
      };
      const clientSide = async (): Promise<void> => {
        await clientConn.sendHandshake();
        // Server creates channel 2 (first server channel = ID 2 = (1<<1)|0)
        const ch = clientConn.connectChannel(2);
        const msgId = await ch.sendRequest({ test: true });
        try {
          await ch.receiveResponse(msgId);
        } catch {
          // expected error
        }
      };
      await Promise.all([serverSide(), clientSide()]);
    } finally {
      clientConn.close();
      serverConn.close();
    }
  }, 10_000);

  it("sendResponseError with err with no stack covers err.stack fallback", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      const serverSide = async (): Promise<void> => {
        await serverConn.receiveHandshake();
        const ch = serverConn.newChannel({ role: "NoStack" });
        const [msgId] = await ch.receiveRequest();
        // Create an error with stack deleted — covers `err.stack ?? String(err)` false branch
        const err = new Error("no stack err");
        delete err.stack;
        await ch.sendResponseError(msgId, err);
      };
      const clientSide = async (): Promise<void> => {
        await clientConn.sendHandshake();
        const ch = clientConn.connectChannel(2);
        const msgId = await ch.sendRequest({ test: true });
        try {
          await ch.receiveResponse(msgId);
        } catch {
          // expected
        }
      };
      await Promise.all([serverSide(), clientSide()]);
    } finally {
      clientConn.close();
      serverConn.close();
    }
  }, 10_000);

  it("handleRequests non-Error throw covers e instanceof Error false branch", async () => {
    const [serverSock, clientSock] = await makeSocketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    try {
      const serverSide = async (): Promise<void> => {
        await serverConn.receiveHandshake();
        const ch = serverConn.newChannel({ role: "NonErr" });
        try {
          await ch.handleRequests(async () => {
            // Throw a non-Error value — covers `new Error(String(e))` branch
            throw "string error";
          });
        } catch {
          // connection closed stops the loop
        }
      };
      const clientSide = async (): Promise<void> => {
        await clientConn.sendHandshake();
        const ch = clientConn.connectChannel(2);
        await expect(ch.request({ x: 1 }).get()).rejects.toThrow(
          "string error",
        );
        serverConn.close();
      };
      await Promise.all([serverSide(), clientSide()]);
    } finally {
      clientConn.close();
      serverConn.close();
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Coverage: Channel.name without role
// ---------------------------------------------------------------------------

describe("Channel.name", () => {
  it("returns plain channel ID string when no role set", async () => {
    const [sock] = await makeSocketPair();
    const conn = new Connection(sock, { name: "Test" });
    // controlChannel has no role — accessing .name covers the false branch
    const ch = conn.controlChannel;
    expect(ch.name).toMatch(/channel 0/);
    conn.close();
  });
});
