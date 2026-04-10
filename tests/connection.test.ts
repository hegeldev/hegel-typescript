/**
 * Tests for Connection and Stream abstractions.
 *
 * Uses TCP socket pairs (server/client) to simulate Unix socket pairs.
 * No mock servers — tests exercise real Connection/Stream logic.
 */

import * as net from "net";
import { describe, it, expect, vi } from "vitest";
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

/**
 * Raw handshake responder: reads the handshake request from the control stream
 * and replies with "Hegel/0.10". Sets the connection to CLIENT state with a high
 * stream ID base to avoid collisions with the actual client side.
 */
async function rawHandshakeResponder(conn: Connection): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (conn as any)._connectionState = ConnectionState.CLIENT;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (conn as any)._nextStreamId = 1000;
  const [msgId] = await conn.controlStream.receiveRequestRaw();
  await conn.controlStream.sendResponseRaw(msgId, Buffer.from("Hegel/0.10"));
}

/** Perform handshake on both sides concurrently. */
async function handshakePair(serverConn: Connection, clientConn: Connection): Promise<void> {
  await Promise.all([rawHandshakeResponder(serverConn), clientConn.sendHandshake()]);
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
    const conn = new Connection(serverSock, serverSock, { name: "Live" });
    expect(conn.live).toBe(true);
    conn.close();
    expect(conn.live).toBe(false);
    serverSock.destroy();
  });

  it("double close does not throw", async () => {
    const [serverSock] = await socketPair();
    const conn = new Connection(serverSock, serverSock, { name: "DoubleClose" });
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
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);
    await expect(clientConn.sendHandshake()).rejects.toThrow(/Handshake already established/);

    clientConn.close();
    serverConn.close();
  });

  it("bad handshake response to client raises ConnectionError", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });

    const badServer = async () => {
      const ch = serverConn.controlStream;
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
// Stream allocation
// ---------------------------------------------------------------------------

describe("stream allocation", () => {
  it("new_stream before handshake throws", async () => {
    const [serverSock] = await socketPair();
    const conn = new Connection(serverSock, serverSock, { name: "Test" });
    expect(() => conn.newStream({ role: "test" })).toThrow(/Cannot create a new stream/);
    conn.close();
    serverSock.destroy();
  });

  it("connect_stream before handshake throws", async () => {
    const [serverSock] = await socketPair();
    const conn = new Connection(serverSock, serverSock, { name: "Test" });
    expect(() => conn.connectStream(1)).toThrow(/Cannot create a new stream/);
    conn.close();
    serverSock.destroy();
  });

  it("client streams get odd IDs: 1, 3, 5", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const ch1 = clientConn.newStream({ role: "A" });
    const ch2 = clientConn.newStream({ role: "B" });
    const ch3 = clientConn.newStream({ role: "C" });

    expect(ch1.streamId % 2).toBe(1);
    expect(ch2.streamId % 2).toBe(1);
    expect(ch3.streamId % 2).toBe(1);
    expect(ch1.streamId).toBe(1);
    expect(ch2.streamId).toBe(3);
    expect(ch3.streamId).toBe(5);

    clientConn.close();
    serverConn.close();
  });

  it("connect_stream to already-connected stream throws", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    // Stream 0 (control) already exists
    expect(() => clientConn.connectStream(0)).toThrow(/Stream already connected/);

    clientConn.close();
    serverConn.close();
  });
});

// ---------------------------------------------------------------------------
// Stream close
// ---------------------------------------------------------------------------

describe("stream close", () => {
  it("close is idempotent (can close twice)", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const ch = clientConn.newStream({ role: "TestClose" });
    ch.close();
    expect(() => ch.close()).not.toThrow();

    serverConn.close();
    clientConn.close();
  });

  it("closing stream when connection not live does not throw", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const ch = clientConn.newStream({ role: "TestClose" });
    clientConn.close();
    expect(() => ch.close()).not.toThrow();

    serverConn.close();
  });

  it("receive_request on closed stream throws ConnectionError", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const ch = clientConn.newStream({ role: "TestClosed" });
    ch.close();

    await expect(ch.receiveRequest({ timeoutMs: 100 })).rejects.toThrow(/is closed/);

    serverConn.close();
    clientConn.close();
  });
});

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

describe("stream timeout", () => {
  it("receive_request times out when no message arrives", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const ch = clientConn.newStream({ role: "TestTimeout" });

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
    const conn = new Connection(serverSock, serverSock, { name: "Test" });
    const ch = conn.controlStream;
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
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    // Server creates a stream and handles one request
    const serverCh = serverConn.newStream({ role: "Handler" });
    const serverHandle = (async () => {
      const [msgId, body] = await serverCh.receiveRequest();
      const msg = body as Record<string, number>;
      await serverCh.sendResponseValue(msgId, { sum: msg.x + msg.y });
    })();

    // Client connects to that stream and sends a request
    const clientCh = clientConn.connectStream(serverCh.streamId);
    const msgId = await clientCh.sendRequest({ x: 2, y: 3 });
    const result = await clientCh.receiveResponse(msgId);
    expect(result).toEqual({ sum: 5 });

    await serverHandle;
    clientConn.close();
    serverConn.close();
  });

  it("PendingRequest.get() caches result on second call", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newStream({ role: "PR" });
    const serverHandle = (async () => {
      const [msgId, body] = await serverCh.receiveRequest();
      const msg = body as Record<string, number>;
      await serverCh.sendResponseValue(msgId, msg.value * 2);
    })();

    const clientCh = clientConn.connectStream(serverCh.streamId);
    const pending = clientCh.request({ value: 21 });
    expect(await pending.get()).toBe(42);
    expect(await pending.get()).toBe(42); // cached

    await serverHandle;
    clientConn.close();
    serverConn.close();
  });
});

// ---------------------------------------------------------------------------
// Message to nonexistent stream
// ---------------------------------------------------------------------------

describe("message to nonexistent stream", () => {
  it("sends error reply and continues working", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });

    await handshakePair(serverConn, clientConn);

    // Send a packet to a stream that does not exist on the server
    const badPacket: Packet = {
      streamId: 999,
      messageId: 1,
      isReply: false,
      payload: encodeValue({ command: "test" }),
    };
    await serverConn.sendPacket(badPacket);

    // Prove the connection is still alive by doing a normal exchange
    await clientConn.controlStream.sendRequestRaw(Buffer.from("ping"));
    await serverConn.controlStream.receiveRequestRaw();

    serverConn.close();
    clientConn.close();
  });
});

// ---------------------------------------------------------------------------
// ConnectionState enum
// ---------------------------------------------------------------------------

describe("ConnectionState", () => {
  it("has UNRESOLVED and CLIENT values", () => {
    expect(ConnectionState.UNRESOLVED).toBeDefined();
    expect(ConnectionState.CLIENT).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Coverage: Stream.close() when stream was replaced in the map
// ---------------------------------------------------------------------------

describe("Stream.close() on replaced stream", () => {
  it("sets _closed without sending a packet when stream is no longer in map", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const ch = clientConn.newStream({ role: "OldCh" });
    // Replace stream in map with a dead marker (as _dispatch does after close-stream message)
    clientConn.streams.set(ch.streamId, "dead:OldCh");
    // close() should set _closed but not throw (stream is no longer the current holder)
    expect(() => ch.close()).not.toThrow();

    clientConn.close();
    serverConn.close();
  });
});

// ---------------------------------------------------------------------------
// Coverage: _waitForMessage post-loop closed-stream error (SHUTDOWN via close())
// ---------------------------------------------------------------------------

describe("_waitForMessage post-loop closed via stream.close()", () => {
  it("raises stream-closed error when stream is closed while waiting", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const ch = clientConn.newStream({ role: "WaitCh" });
    // Wait for a message, then close the stream after a short delay
    const waiter = ch.receiveRequest({ timeoutMs: 500 }).catch((e: unknown) => e);
    // Close the stream quickly — this sets _closed on the stream
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
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const clientCh = clientConn.newStream({ role: "WaitForShutdown" });
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
// Coverage: _waitForMessage SHUTDOWN injected during the while loop (line 621)
// ---------------------------------------------------------------------------

describe("_waitForMessage SHUTDOWN during while loop", () => {
  it("raises Connection closed when SHUTDOWN is injected mid-loop", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const ch = clientConn.newStream({ role: "ShutdownInLoop" });
    // Start waiting for a message
    const waiter = ch.receiveRequest({ timeoutMs: 2000 }).catch((e: unknown) => e);
    // After a short delay, inject SHUTDOWN directly into the inbox.
    // This triggers the post-loop SHUTDOWN path in _waitForMessage.
    setTimeout(() => {
      ch.inbox.push(SHUTDOWN);
      ch._notifyWaiter();
    }, 50);
    const err = await waiter;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Connection closed");

    clientConn.close();
    serverConn.close();
  });
});

// ---------------------------------------------------------------------------
// Coverage: _dispatch with close-stream payload
// ---------------------------------------------------------------------------

describe("dispatch close-stream payload", () => {
  it("marks stream as dead when close-stream packet is received", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newStream({ role: "ToClose" });
    const clientCh = clientConn.connectStream(serverCh.streamId);

    // Client closes the stream, sending a close-stream packet to the server.
    clientCh.close();

    // Background reader on serverConn will process the close-stream packet.
    // Wait for it to be dispatched.
    await vi.waitFor(() => {
      const v = serverConn.streams.get(serverCh.streamId);
      expect(typeof v === "string").toBe(true);
    });

    serverConn.close();
    clientConn.close();
  });

  it("marks stream as dead even when no stream exists for that ID", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    // Create a stream on the client, but DON'T connect it on the server.
    // When client sends close-stream, server has no stream for that ID.
    const clientCh = clientConn.newStream({ role: "Ghost" });
    clientCh.close(); // sends CLOSE_STREAM_PAYLOAD to server

    // Background reader on serverConn dispatches the close-stream packet.
    await vi.waitFor(() => {
      expect(serverConn.streams.has(clientCh.streamId)).toBe(true);
    });

    // Connection still alive
    expect(serverConn.live).toBe(true);
    serverConn.close();
    clientConn.close();
  });
});

// ---------------------------------------------------------------------------
// Coverage: message to closed (dead) stream
// ---------------------------------------------------------------------------

describe("message to dead stream", () => {
  it("sends error reply for request to closed stream", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newStream({ role: "DeadCh" });
    const clientCh = clientConn.connectStream(serverCh.streamId);

    // Mark the stream as dead on server side
    serverConn.streams.set(serverCh.streamId, "dead:DeadCh");

    // Send a request from client — server should reply with error
    await expect(clientCh.request({ x: 1 }).get()).rejects.toThrow(RequestError);

    serverConn.close();
    clientConn.close();
  });

  it("silently drops reply packet to dead stream (isReply=true)", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const serverCh = serverConn.newStream({ role: "DeadReply" });
    // Mark as dead on server
    serverConn.streams.set(serverCh.streamId, "dead:DeadReply");

    // Create a second stream to receive a real request after the dead-reply packet.
    // The reader will read both: the reply to the dead stream (silently dropped),
    // then the real request to the live stream.
    const serverCh2 = serverConn.newStream({ role: "LiveCh" });
    const clientCh2 = clientConn.connectStream(serverCh2.streamId);

    // Send a REPLY from client to the dead stream first
    await clientConn.sendPacket({
      streamId: serverCh.streamId,
      messageId: 1,
      isReply: true,
      payload: encodeValue({ result: "nope" }),
    });
    // Then send a real request to the live stream
    await clientCh2.sendRequest({ ping: true });

    // Server reads both: drops the dead reply, delivers the request
    const [msgId, body] = await serverCh2.receiveRequest({ timeoutMs: 1000 });
    expect((body as Record<string, boolean>).ping).toBe(true);
    await serverCh2.sendResponseValue(msgId, "pong");

    expect(serverConn.live).toBe(true);
    serverConn.close();
    clientConn.close();
  });

  it("swallows sendPacket error when socket fails during error reply to dead stream", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    // Create a live stream for the server to wait on
    const serverLive = serverConn.newStream({ role: "Live" });
    const clientLive = clientConn.connectStream(serverLive.streamId);

    // Create a dead stream
    const serverCh = serverConn.newStream({ role: "FailReply" });
    serverConn.streams.set(serverCh.streamId, "dead:FailReply");

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

    // Send a request to the dead stream — reader will dispatch it,
    // sendPacket() will fail (mocked), .catch() fires.
    await clientConn.sendPacket({
      streamId: serverCh.streamId,
      messageId: 1,
      isReply: false,
      payload: encodeValue({ command: "test" }),
    });
    // Send a live-stream request to unblock the server's receive after the dead one
    await clientLive.sendRequest({ ping: true });

    // Server reads both packets; the dead-stream error reply fails (caught by .catch),
    // then the live-stream request arrives.
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
// Coverage: _waitForMessage with data already ready after drain (line 672)
// ---------------------------------------------------------------------------

describe("_waitForMessage data already ready", () => {
  it("returns immediately when inbox has data before waiting", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    // Pre-populate the inbox with a packet so receiveRequest returns immediately.
    const serverCh = serverConn.newStream({ role: "PreReady" });
    const packet: Packet = {
      streamId: serverCh.streamId,
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
    const serverConn = new Connection(serverSock, serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, clientSock, { name: "Client" });
    await handshakePair(serverConn, clientConn);

    const ch = clientConn.newStream({ role: "DeadReq" });
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
