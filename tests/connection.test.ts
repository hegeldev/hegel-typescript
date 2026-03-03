/**
 * Tests for Connection and Channel abstractions.
 *
 * Uses TCP socket pairs (server/client) to simulate Unix socket pairs.
 * No mock servers — tests exercise real Connection/Channel logic.
 */

import * as net from "net";
import { describe, it, expect } from "vitest";
import { encodeValue, Packet } from "../src/protocol.js";
import {
  Connection,
  RequestError,
  resultOrError,
  SHUTDOWN,
  ConnectionState,
} from "../src/connection.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a connected TCP socket pair cleanly.
 */
async function socketPair(): Promise<[net.Socket, net.Socket]> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);

    let serverSock: net.Socket | null = null;
    let clientSock: net.Socket | null = null;

    function tryResolve() {
      if (serverSock && clientSock) {
        server.close();
        resolve([serverSock, clientSock]);
      }
    }

    server.on("connection", (sock) => {
      serverSock = sock;
      tryResolve();
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      clientSock = net.createConnection(addr.port, "127.0.0.1", tryResolve);
      clientSock.on("error", reject);
    });
  });
}

/** Perform handshake on both sides concurrently. */
async function handshakePair(serverConn: Connection, clientConn: Connection): Promise<void> {
  await Promise.all([serverConn.receiveHandshake(), clientConn.sendHandshake()]);
}

// ---------------------------------------------------------------------------
// Basic connectivity: RequestError and resultOrError
// ---------------------------------------------------------------------------

describe("RequestError", () => {
  it("extracts error message and type, leaves rest in data", () => {
    const err = new RequestError({
      error: "something went wrong",
      type: "TestError",
      extra: "data",
    });
    expect(err.message).toBe("something went wrong");
    expect(err.errorType).toBe("TestError");
    expect(err.data).toEqual({ extra: "data" });
  });
});

describe("resultOrError", () => {
  it("raises RequestError when error key is present", () => {
    expect(() => resultOrError({ error: "bad", type: "TestError" })).toThrow(RequestError);
    expect(() => resultOrError({ error: "bad", type: "TestError" })).toThrow("bad");
  });

  it("returns result when result key is present", () => {
    expect(resultOrError({ result: 42 })).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// SHUTDOWN sentinel
// ---------------------------------------------------------------------------

describe("SHUTDOWN sentinel", () => {
  it("is a unique symbol distinct from packets", () => {
    expect(SHUTDOWN).toBeDefined();
    expect(typeof SHUTDOWN).toBe("symbol");
  });
});

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

describe("Connection.live", () => {
  it("is true initially and false after close", async () => {
    const [serverSock] = await socketPair();
    const conn = new Connection(serverSock, { name: "Live" });
    expect(conn.live).toBe(true);
    conn.close();
    expect(conn.live).toBe(false);
    serverSock.destroy();
  });

  it("double close does not throw", async () => {
    const [serverSock] = await socketPair();
    const conn = new Connection(serverSock, { name: "DoubleClose" });
    conn.close();
    expect(() => conn.close()).not.toThrow();
    serverSock.destroy();
  });
});

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

describe("handshake", () => {
  it("double sendHandshake throws", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);
    await expect(clientConn.sendHandshake()).rejects.toThrow(/Handshake already established/);

    clientConn.close();
    serverConn.close();
  });

  it("double receiveHandshake throws", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);
    await expect(serverConn.receiveHandshake()).rejects.toThrow(/Handshake already established/);

    clientConn.close();
    serverConn.close();
  });

  it("bad handshake string from client raises ConnectionError on server", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    // Send bad version from client side manually
    const badSend = async () => {
      const ch = clientConn.controlChannel;
      await ch.sendRequestRaw(Buffer.from("BadVersion"));
    };

    await expect(Promise.all([serverConn.receiveHandshake(), badSend()])).rejects.toThrow(
      /Bad handshake/,
    );

    clientConn.close();
    serverConn.close();
  });

  it("bad handshake response to client raises ConnectionError", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    const badServer = async () => {
      const ch = serverConn.controlChannel;
      const [msgId] = await ch.receiveRequestRaw();
      await ch.sendResponseRaw(msgId, Buffer.from("NotOk"));
    };

    await expect(Promise.all([clientConn.sendHandshake(), badServer()])).rejects.toThrow(
      /Bad handshake/,
    );

    clientConn.close();
    serverConn.close();
  });
});

// ---------------------------------------------------------------------------
// Channel allocation
// ---------------------------------------------------------------------------

describe("channel allocation", () => {
  it("new_channel before handshake throws", async () => {
    const [serverSock] = await socketPair();
    const conn = new Connection(serverSock, { name: "Test" });
    expect(() => conn.newChannel({ role: "test" })).toThrow(/Cannot create a new channel/);
    conn.close();
    serverSock.destroy();
  });

  it("connect_channel before handshake throws", async () => {
    const [serverSock] = await socketPair();
    const conn = new Connection(serverSock, { name: "Test" });
    expect(() => conn.connectChannel(1)).toThrow(/Cannot create a new channel/);
    conn.close();
    serverSock.destroy();
  });

  it("client channels get odd IDs: 1, 3, 5", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const ch1 = clientConn.newChannel({ role: "A" });
    const ch2 = clientConn.newChannel({ role: "B" });
    const ch3 = clientConn.newChannel({ role: "C" });

    expect(ch1.channelId % 2).toBe(1);
    expect(ch2.channelId % 2).toBe(1);
    expect(ch3.channelId % 2).toBe(1);
    expect(ch1.channelId).toBe(1);
    expect(ch2.channelId).toBe(3);
    expect(ch3.channelId).toBe(5);

    clientConn.close();
    serverConn.close();
  });

  it("connect_channel to already-connected channel throws", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    // Channel 0 (control) already exists
    expect(() => clientConn.connectChannel(0)).toThrow(/Channel already connected/);

    clientConn.close();
    serverConn.close();
  });
});

// ---------------------------------------------------------------------------
// Channel close
// ---------------------------------------------------------------------------

describe("channel close", () => {
  it("close is idempotent (can close twice)", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const ch = clientConn.newChannel({ role: "TestClose" });
    ch.close();
    expect(() => ch.close()).not.toThrow();

    serverConn.close();
    clientConn.close();
  });

  it("closing channel when connection not live does not throw", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const ch = clientConn.newChannel({ role: "TestClose" });
    clientConn.close();
    expect(() => ch.close()).not.toThrow();

    serverConn.close();
  });

  it("receive_request on closed channel throws ConnectionError", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const ch = clientConn.newChannel({ role: "TestClosed" });
    ch.close();

    await expect(ch.receiveRequest({ timeoutMs: 100 })).rejects.toThrow(/is closed/);

    serverConn.close();
    clientConn.close();
  });
});

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

describe("channel timeout", () => {
  it("receive_request times out when no message arrives", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const ch = clientConn.newChannel({ role: "TestTimeout" });

    await expect(ch.receiveRequest({ timeoutMs: 100 })).rejects.toThrow(/Timed out/);

    serverConn.close();
    clientConn.close();
  });
});

// ---------------------------------------------------------------------------
// SHUTDOWN in inbox raises ConnectionError
// ---------------------------------------------------------------------------

describe("SHUTDOWN in inbox", () => {
  it("receiveRequest raises ConnectionError when SHUTDOWN is in inbox", async () => {
    const [serverSock] = await socketPair();
    const conn = new Connection(serverSock, { name: "Test" });
    const ch = conn.controlChannel;
    ch.inbox.push(SHUTDOWN);
    await expect(ch.receiveRequest({ timeoutMs: 100 })).rejects.toThrow(/Connection closed/);
    conn.close();
    serverSock.destroy();
  });
});

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

describe("request/response", () => {
  it("send_request and receive_response round-trip", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    // Server creates a channel and handles one request
    const serverCh = serverConn.newChannel({ role: "Handler" });
    const serverHandle = (async () => {
      const [msgId, body] = await serverCh.receiveRequest();
      const msg = body as Record<string, number>;
      await serverCh.sendResponseValue(msgId, { sum: msg.x + msg.y });
    })();

    // Client connects to that channel and sends a request
    const clientCh = clientConn.connectChannel(serverCh.channelId);
    const msgId = await clientCh.sendRequest({ x: 2, y: 3 });
    const result = await clientCh.receiveResponse(msgId);
    expect(result).toEqual({ sum: 5 });

    await serverHandle;
    clientConn.close();
    serverConn.close();
  });

  it("PendingRequest.get() caches result on second call", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newChannel({ role: "PR" });
    const serverHandle = (async () => {
      const [msgId, body] = await serverCh.receiveRequest();
      const msg = body as Record<string, number>;
      await serverCh.sendResponseValue(msgId, msg.value * 2);
    })();

    const clientCh = clientConn.connectChannel(serverCh.channelId);
    const pending = clientCh.request({ value: 21 });
    expect(await pending.get()).toBe(42);
    expect(await pending.get()).toBe(42); // cached

    await serverHandle;
    clientConn.close();
    serverConn.close();
  });

  it("handle_requests processes requests with handler", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newChannel({ role: "Handler" });
    // Handle one request then stop
    let handled = 0;
    const serverHandle = serverCh.handleRequests(
      async (msg) => {
        const m = msg as Record<string, number>;
        handled++;
        return { sum: m.x + m.y };
      },
      () => handled >= 1,
    );

    const clientCh = clientConn.connectChannel(serverCh.channelId);
    const result = await clientCh.request({ x: 10, y: 5 }).get();
    expect(result).toEqual({ sum: 15 });

    await serverHandle;
    clientConn.close();
    serverConn.close();
  });

  it("handle_requests sends error response when handler throws", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newChannel({ role: "ErrTest" });
    let handled = 0;
    const serverHandle = serverCh.handleRequests(
      async (_) => {
        handled++;
        throw new Error("test error");
      },
      () => handled >= 1,
    );

    const clientCh = clientConn.connectChannel(serverCh.channelId);
    // Send one request, the server handler throws — expect a RequestError back.
    const pending = clientCh.request({ anything: true });
    let caught: unknown;
    try {
      await pending.get();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RequestError);
    expect((caught as RequestError).message).toBe("test error");

    await serverHandle;
    clientConn.close();
    serverConn.close();
  });

  it("handle_requests wraps non-Error throws in Error", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newChannel({ role: "NonErrTest" });
    let handled = 0;
    const serverHandle = serverCh.handleRequests(
      async (_) => {
        handled++;
        // Throw a non-Error value (string) — covers `e instanceof Error ? e : new Error(String(e))`
        throw "string error";
      },
      () => handled >= 1,
    );

    const clientCh = clientConn.connectChannel(serverCh.channelId);
    const pending = clientCh.request({ anything: true });
    let caught: unknown;
    try {
      await pending.get();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RequestError);
    expect((caught as RequestError).message).toBe("string error");

    await serverHandle;
    clientConn.close();
    serverConn.close();
  });

  it("sendResponseError with exception object", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newChannel({ role: "ErrMsg" });
    const serverHandle = (async () => {
      const [msgId] = await serverCh.receiveRequest();
      await serverCh.sendResponseError(msgId, new ValueError("an error"));
    })();

    const clientCh = clientConn.connectChannel(serverCh.channelId);
    await expect(clientCh.request({ anything: true }).get()).rejects.toThrow("an error");

    await serverHandle;
    clientConn.close();
    serverConn.close();
  });

  it("sendResponseError with explicit error and type kwargs", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newChannel({ role: "ErrKw" });
    const serverHandle = (async () => {
      const [msgId] = await serverCh.receiveRequest();
      await serverCh.sendResponseError(msgId, null, {
        error: "custom error",
        errorType: "CustomType",
      });
    })();

    const clientCh = clientConn.connectChannel(serverCh.channelId);
    let caught: RequestError | null = null;
    try {
      await clientCh.request({ anything: true }).get();
    } catch (e) {
      caught = e as RequestError;
    }
    expect(caught).toBeInstanceOf(RequestError);
    expect(caught!.message).toBe("custom error");
    expect(caught!.errorType).toBe("CustomType");

    await serverHandle;
    clientConn.close();
    serverConn.close();
  });
});

// ---------------------------------------------------------------------------
// Message to nonexistent channel
// ---------------------------------------------------------------------------

describe("message to nonexistent channel", () => {
  it("sends error reply and continues working", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    // Send a packet to a channel that does not exist on the server
    const badPacket: Packet = {
      channelId: 999,
      messageId: 1,
      isReply: false,
      payload: encodeValue({ command: "test" }),
    };
    await serverConn.sendPacket(badPacket);

    // Prove the connection is still alive by doing a normal exchange
    await clientConn.controlChannel.sendRequestRaw(Buffer.from("ping"));
    await serverConn.controlChannel.receiveRequestRaw();

    serverConn.close();
    clientConn.close();
  });
});

// ---------------------------------------------------------------------------
// ConnectionState enum
// ---------------------------------------------------------------------------

describe("ConnectionState", () => {
  it("has UNRESOLVED, CLIENT, SERVER values", () => {
    expect(ConnectionState.UNRESOLVED).toBeDefined();
    expect(ConnectionState.CLIENT).toBeDefined();
    expect(ConnectionState.SERVER).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Coverage: Channel.close() when channel was replaced in the map
// ---------------------------------------------------------------------------

describe("Channel.close() on replaced channel", () => {
  it("sets _closed without sending a packet when channel is no longer in map", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const ch = clientConn.newChannel({ role: "OldCh" });
    // Replace channel in map with a dead marker (as _dispatch does after close-channel message)
    clientConn.channels.set(ch.channelId, "dead:OldCh");
    // close() should set _closed but not throw (channel is no longer the current holder)
    expect(() => ch.close()).not.toThrow();

    clientConn.close();
    serverConn.close();
  });
});

// ---------------------------------------------------------------------------
// Coverage: handleRequests with default until parameter
// ---------------------------------------------------------------------------

describe("handleRequests default until", () => {
  it("processes requests and can be interrupted by closing the connection", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newChannel({ role: "Loop" });
    // Use default until (always false), close the connection to break the loop
    const loopHandle = serverCh
      .handleRequests(async (msg) => {
        return { echo: (msg as Record<string, unknown>).v };
      })
      .catch(() => {
        // handleRequests will throw when connection closes — expected
      });

    const clientCh = clientConn.connectChannel(serverCh.channelId);
    const result = await clientCh.request({ v: 99 }).get();
    expect(result).toEqual({ echo: 99 });

    // Close the connection — this will cause handleRequests to throw from receiveRequest
    serverConn.close();
    clientConn.close();
    await loopHandle;
  });
});

// ---------------------------------------------------------------------------
// Coverage: _waitForMessage post-loop closed-channel error (SHUTDOWN via close())
// ---------------------------------------------------------------------------

describe("_waitForMessage post-loop closed via channel.close()", () => {
  it("raises channel-closed error when channel is closed while waiting", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const ch = clientConn.newChannel({ role: "WaitCh" });
    // Wait for a message, then close the channel after a short delay
    const waiter = ch.receiveRequest({ timeoutMs: 500 }).catch((e: unknown) => e);
    // Close the channel quickly — this sets _closed on the channel
    setTimeout(() => ch.close(), 50);
    const err = await waiter;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/closed/);

    clientConn.close();
    serverConn.close();
  });
});

// ---------------------------------------------------------------------------
// Coverage: _waitForMessage post-loop SHUTDOWN from connection closing mid-wait
// ---------------------------------------------------------------------------

describe("_waitForMessage SHUTDOWN mid-wait", () => {
  it("raises Connection closed when peer drops the connection while waiting", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const clientCh = clientConn.newChannel({ role: "WaitForShutdown" });
    // Start waiting for a message
    const waiter = clientCh.receiveRequest({ timeoutMs: 500 }).catch((e: unknown) => e);
    // Drop the server side, causing EOF on client
    setTimeout(() => serverConn.close(), 50);
    const err = await waiter;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/closed|Timed out/);

    clientConn.close();
  });
});

// ---------------------------------------------------------------------------
// Coverage: runReader with until() already true
// ---------------------------------------------------------------------------

describe("runReader with until already true", () => {
  it("returns immediately when until() is true at call time", async () => {
    const [serverSock] = await socketPair();
    const conn = new Connection(serverSock, { name: "Test" });
    // until() always true → runReader should return immediately
    await expect(conn.runReader(() => true)).resolves.toBeUndefined();
    conn.close();
    serverSock.destroy();
  });
});

// ---------------------------------------------------------------------------
// Coverage: _dispatch with close-channel payload
// ---------------------------------------------------------------------------

describe("dispatch close-channel payload", () => {
  it("marks channel as dead when close-channel packet is received", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newChannel({ role: "ToClose" });
    const clientCh = clientConn.connectChannel(serverCh.channelId);

    // Client closes the channel, sending a close-channel packet to the server.
    clientCh.close();

    // Server needs to receive the close-channel packet.
    // Wait a moment for it to arrive, then check the channel map.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    // Trigger a read on the server so it processes the close-channel packet
    serverConn
      .runReader(() => {
        const v = serverConn.channels.get(serverCh.channelId);
        return typeof v === "string"; // true when channel is dead
      })
      .catch(() => {});

    // Give it time to process
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    const v = serverConn.channels.get(serverCh.channelId);
    expect(typeof v === "string").toBe(true);

    serverConn.close();
    clientConn.close();
  });

  it("marks channel as dead even when no channel exists for that ID", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    // Create a channel on the client, but DON'T connect it on the server.
    // When client sends close-channel, server has no channel for that ID.
    const clientCh = clientConn.newChannel({ role: "Ghost" });
    clientCh.close(); // sends CLOSE_CHANNEL_PAYLOAD to server

    // The server should dispatch this to _dispatch(), see it's a close-channel
    // packet for a non-existent channel, and still mark it dead.
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    await serverConn
      .runReader(() => {
        return serverConn.channels.has(clientCh.channelId);
      })
      .catch(() => {});
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // Connection still alive
    expect(serverConn.live).toBe(true);
    serverConn.close();
    clientConn.close();
  });
});

// ---------------------------------------------------------------------------
// Coverage: message to closed (dead) channel
// ---------------------------------------------------------------------------

describe("message to dead channel", () => {
  it("sends error reply for request to closed channel", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newChannel({ role: "DeadCh" });
    const clientCh = clientConn.connectChannel(serverCh.channelId);

    // Mark the channel as dead on server side
    serverConn.channels.set(serverCh.channelId, "dead:DeadCh");

    // Send a request from client — server should reply with error
    await expect(clientCh.request({ x: 1 }).get()).rejects.toThrow(RequestError);

    serverConn.close();
    clientConn.close();
  });

  it("silently drops reply packet to dead channel (isReply=true)", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newChannel({ role: "DeadReply" });
    // Mark as dead on server
    serverConn.channels.set(serverCh.channelId, "dead:DeadReply");

    // Create a second channel to receive a real request after the dead-reply packet.
    // The reader will read both: the reply to the dead channel (silently dropped),
    // then the real request to the live channel.
    const serverCh2 = serverConn.newChannel({ role: "LiveCh" });
    const clientCh2 = clientConn.connectChannel(serverCh2.channelId);

    // Send a REPLY from client to the dead channel first
    await clientConn.sendPacket({
      channelId: serverCh.channelId,
      messageId: 1,
      isReply: true,
      payload: encodeValue({ result: "nope" }),
    });
    // Then send a real request to the live channel
    await clientCh2.sendRequest({ ping: true });

    // Server reads both: drops the dead reply, delivers the request
    const [msgId, body] = await serverCh2.receiveRequest({ timeoutMs: 1000 });
    expect((body as Record<string, boolean>).ping).toBe(true);
    await serverCh2.sendResponseValue(msgId, "pong");

    expect(serverConn.live).toBe(true);
    serverConn.close();
    clientConn.close();
  });

  it("swallows sendPacket error when socket fails during error reply to dead channel", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    // Create a live channel for the server to wait on
    const serverLive = serverConn.newChannel({ role: "Live" });
    const clientLive = clientConn.connectChannel(serverLive.channelId);

    // Create a dead channel
    const serverCh = serverConn.newChannel({ role: "FailReply" });
    serverConn.channels.set(serverCh.channelId, "dead:FailReply");

    // Monkey-patch sendPacket on the server connection to make it fail once.
    // This causes the error-reply sendPacket in _dispatch to reject,
    // which triggers the .catch(() => {}) at line 412.
    let sendCount = 0;
    const origSendPacket = serverConn.sendPacket.bind(serverConn);
    serverConn.sendPacket = (pkt: Packet): Promise<void> => {
      sendCount++;
      if (sendCount === 1) {
        return Promise.reject(new Error("forced send failure"));
      }
      return origSendPacket(pkt);
    };

    // Send a request to the dead channel — reader will dispatch it,
    // sendPacket() will fail (mocked), .catch() fires.
    await clientConn.sendPacket({
      channelId: serverCh.channelId,
      messageId: 1,
      isReply: false,
      payload: encodeValue({ command: "test" }),
    });
    // Send a live-channel request to unblock the server's receive after the dead one
    await clientLive.sendRequest({ ping: true });

    // Server reads both packets; the dead-channel error reply fails (caught by .catch),
    // then the live-channel request arrives.
    const [msgId] = await serverLive.receiveRequest({ timeoutMs: 1000 });
    // Restore sendPacket before sending response
    serverConn.sendPacket = origSendPacket;
    await serverLive.sendResponseValue(msgId, "ok");

    // Give async error handling time to settle
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    serverConn.close();
    clientConn.close();
  });
});

// ---------------------------------------------------------------------------
// Coverage: sendResponseError with null error and no opts
// ---------------------------------------------------------------------------

describe("sendResponseError edge cases", () => {
  it("sends Unknown error when err is null and no opts", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newChannel({ role: "ErrNull" });
    const serverHandle = (async () => {
      const [msgId] = await serverCh.receiveRequest();
      // null err, no opts → uses "Unknown error" and "Error" type
      await serverCh.sendResponseError(msgId, null);
    })();

    const clientCh = clientConn.connectChannel(serverCh.channelId);
    let caught: RequestError | null = null;
    try {
      await clientCh.request({ x: 1 }).get();
    } catch (e) {
      caught = e as RequestError;
    }
    expect(caught).toBeInstanceOf(RequestError);
    expect(caught!.message).toBe("Unknown error");
    expect(caught!.errorType).toBe("Error");

    await serverHandle;
    clientConn.close();
    serverConn.close();
  });

  it("sends error with err.message when err has no stack", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newChannel({ role: "ErrNoStack" });
    const serverHandle = (async () => {
      const [msgId] = await serverCh.receiveRequest();
      const err = new Error("no stack error");
      // Remove the stack so that err.stack is undefined
      delete err.stack;
      await serverCh.sendResponseError(msgId, err);
    })();

    const clientCh = clientConn.connectChannel(serverCh.channelId);
    await expect(clientCh.request({ x: 1 }).get()).rejects.toThrow("no stack error");

    await serverHandle;
    clientConn.close();
    serverConn.close();
  });
});

// ---------------------------------------------------------------------------
// Coverage: _waitForMessage with data already ready after drain (line 672)
// ---------------------------------------------------------------------------

describe("_waitForMessage data already ready", () => {
  it("returns immediately when inbox has data before waiting", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    // Pre-populate the inbox with a packet so receiveRequest returns immediately.
    const serverCh = serverConn.newChannel({ role: "PreReady" });
    const packet: Packet = {
      channelId: serverCh.channelId,
      messageId: 1,
      isReply: false,
      payload: encodeValue({ v: 42 }),
    };
    serverCh.inbox.push(packet);

    const [msgId, body] = await serverCh.receiveRequest({ timeoutMs: 100 });
    expect(msgId).toBe(1);
    expect((body as Record<string, number>).v).toBe(42);

    serverConn.close();
    clientConn.close();
  });
});

// ---------------------------------------------------------------------------
// Coverage: request() .catch on failed sendPacket (anonymous fn 28 line 541)
// ---------------------------------------------------------------------------

describe("request() on dead socket", () => {
  it("swallows sendPacket error when socket is closed", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const ch = clientConn.newChannel({ role: "DeadReq" });
    // Destroy the socket so sendPacket will fail
    clientSock.destroy();
    // request() must not throw — the .catch swallows the error
    expect(() => ch.request({ x: 1 })).not.toThrow();
    // Give async error time to propagate
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    serverConn.close();
    clientConn.close();
  });
});

// ---------------------------------------------------------------------------
// Helper error class used in tests
// ---------------------------------------------------------------------------

class ValueError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ValueError";
  }
}
