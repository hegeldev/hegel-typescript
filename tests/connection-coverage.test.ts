/**
 * Tests for uncovered paths in connection.ts:
 *
 * - markServerExited() / hasServerExited()
 * - readExact EOF handling (bytesRead === 0)
 * - readExact re-throw of non-EAGAIN errors
 * - Stream.receiveReply when response is already buffered
 * - Stream.receiveRequest when request is already buffered
 * - Stream.receiveReply getting a non-reply packet (buffers it as request)
 * - Stream.receiveRequest getting a reply packet (buffers it as response)
 * - Stream.close() called twice
 * - Operations on a closed/markClosed stream
 */

import { spawn, type ChildProcess } from "node:child_process";
import { describe, it, expect, afterEach } from "vitest";
import { Connection, Stream } from "../src/connection.js";
import { encodePacket, type Packet } from "../src/protocol.js";
import * as fs from "node:fs";

// ---------------------------------------------------------------------------
// Helper: create a Connection backed by a `cat` subprocess
// ---------------------------------------------------------------------------

let activeChildren: ChildProcess[] = [];

function createCatConnection(): { connection: Connection; child: ChildProcess } {
  const child = spawn("cat", [], { stdio: ["pipe", "pipe", "ignore"] });
  child.stdout!.pause();
  child.stdin!.cork();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readFd = (child.stdout as any)._handle.fd as number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writeFd = (child.stdin as any)._handle.fd as number;

  const connection = new Connection(readFd, writeFd);
  activeChildren.push(child);
  return { connection, child };
}

afterEach(() => {
  for (const child of activeChildren) {
    try {
      child.kill();
    } catch {
      // ignore
    }
  }
  activeChildren = [];
});

// ---------------------------------------------------------------------------
// markServerExited / hasServerExited
// ---------------------------------------------------------------------------

describe("Connection.markServerExited / hasServerExited", () => {
  it("starts as false, becomes true after markServerExited", () => {
    const { connection } = createCatConnection();
    expect(connection.hasServerExited()).toBe(false);
    connection.markServerExited();
    expect(connection.hasServerExited()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readExact EOF handling
// ---------------------------------------------------------------------------

describe("Connection.readExact EOF", () => {
  it("throws on EOF (bytesRead === 0) and marks server as exited", () => {
    const { connection, child } = createCatConnection();

    // Kill cat so its stdout pipe closes -> readSync returns 0
    child.kill("SIGKILL");

    // Give a moment for the process to actually exit
    // Use a small busy-wait since we need synchronous behavior
    const start = Date.now();
    while (Date.now() - start < 200) {
      if (child.killed || child.exitCode !== null) break;
    }

    // Try to read - should get EOF
    expect(() => connection.readExact(1)).toThrow("Connection closed: server process exited");
    expect(connection.hasServerExited()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readExact re-throw of non-EAGAIN errors
// ---------------------------------------------------------------------------

describe("Connection.readExact error re-throw", () => {
  it("re-throws non-EAGAIN errors from fs.readSync", () => {
    // Use an invalid file descriptor to get an EBADF error
    const connection = new Connection(999999, 999999);
    expect(() => connection.readExact(1)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Stream: close() called twice is no-op
// ---------------------------------------------------------------------------

describe("Stream.close", () => {
  it("second close() is a no-op", () => {
    const { connection } = createCatConnection();
    const stream = connection.newStream();
    stream.close();
    // Second close should not throw
    stream.close();
  });
});

// ---------------------------------------------------------------------------
// Stream: markClosed + operations on closed stream
// ---------------------------------------------------------------------------

describe("Stream.markClosed", () => {
  it("sendRequest throws on closed stream", () => {
    const { connection } = createCatConnection();
    const stream = connection.newStream();
    stream.markClosed();
    expect(() => stream.sendRequest(Buffer.from("test"))).toThrow("Stream is closed");
  });

  it("receiveReply throws on closed stream", () => {
    const { connection } = createCatConnection();
    const stream = connection.newStream();
    stream.markClosed();
    expect(() => stream.receiveReply(1)).toThrow("Stream is closed");
  });

  it("receiveRequest throws on closed stream", () => {
    const { connection } = createCatConnection();
    const stream = connection.newStream();
    stream.markClosed();
    expect(() => stream.receiveRequest()).toThrow("Stream is closed");
  });
});

// ---------------------------------------------------------------------------
// Stream: packet buffering paths
//
// To test buffering, we send multiple packets with different stream IDs or
// reply flags, then read them back in different orders via receiveReply and
// receiveRequest.
// ---------------------------------------------------------------------------

/**
 * Write a raw packet to the writeFd of the cat subprocess so it echoes back
 * through the Connection's readFd.
 */
function writeRawPacket(child: ChildProcess, packet: Packet): void {
  const data = encodePacket(packet);
  // Write directly to the cat subprocess stdin fd
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writeFd = (child.stdin as any)._handle.fd as number;
  fs.writeSync(writeFd, data);
}

describe("Stream packet buffering", () => {
  it("receiveReply buffers non-reply packets as requests", () => {
    const { connection, child } = createCatConnection();
    const streamId = 1;
    const stream = new Stream(streamId, connection);

    // Send a request packet (not a reply) for this stream,
    // followed by a reply packet that receiveReply is waiting for.
    const requestPacket: Packet = {
      streamId,
      messageId: 100,
      isReply: false,
      payload: Buffer.from("request-data"),
    };
    const replyPacket: Packet = {
      streamId,
      messageId: 1,
      isReply: true,
      payload: Buffer.from("reply-data"),
    };

    // Write both packets - cat will echo them back
    writeRawPacket(child, requestPacket);
    writeRawPacket(child, replyPacket);

    // receiveReply(1) should skip the request packet (buffer it) and return the reply
    const reply = stream.receiveReply(1);
    expect(reply).toEqual(Buffer.from("reply-data"));

    // Now receiveRequest should return the buffered request immediately
    const [msgId, payload] = stream.receiveRequest();
    expect(msgId).toBe(100);
    expect(payload).toEqual(Buffer.from("request-data"));
  });

  it("receiveRequest buffers reply packets as responses", () => {
    const { connection, child } = createCatConnection();
    const streamId = 3;
    const stream = new Stream(streamId, connection);

    // Send a reply packet first, then a request packet
    const replyPacket: Packet = {
      streamId,
      messageId: 5,
      isReply: true,
      payload: Buffer.from("buffered-reply"),
    };
    const requestPacket: Packet = {
      streamId,
      messageId: 200,
      isReply: false,
      payload: Buffer.from("the-request"),
    };

    writeRawPacket(child, replyPacket);
    writeRawPacket(child, requestPacket);

    // receiveRequest should skip the reply (buffer it) and return the request
    const [msgId, payload] = stream.receiveRequest();
    expect(msgId).toBe(200);
    expect(payload).toEqual(Buffer.from("the-request"));

    // Now receiveReply(5) should return the buffered reply immediately
    const reply = stream.receiveReply(5);
    expect(reply).toEqual(Buffer.from("buffered-reply"));
  });

  it("receiveReply with already-buffered response returns immediately", () => {
    const { connection, child } = createCatConnection();
    const streamId = 5;
    const stream = new Stream(streamId, connection);

    // Send two reply packets with different message IDs
    const reply1: Packet = {
      streamId,
      messageId: 10,
      isReply: true,
      payload: Buffer.from("first-reply"),
    };
    const reply2: Packet = {
      streamId,
      messageId: 20,
      isReply: true,
      payload: Buffer.from("second-reply"),
    };

    writeRawPacket(child, reply1);
    writeRawPacket(child, reply2);

    // Ask for reply 20 first - this will read reply 10 and buffer it
    const second = stream.receiveReply(20);
    expect(second).toEqual(Buffer.from("second-reply"));

    // Now ask for reply 10 - already buffered in responses map
    const first = stream.receiveReply(10);
    expect(first).toEqual(Buffer.from("first-reply"));
  });

  it("receiveRequest with already-buffered request returns immediately", () => {
    const { connection, child } = createCatConnection();
    const streamId = 7;
    const stream = new Stream(streamId, connection);

    // First call receiveReply which will buffer any non-reply packets
    // Send: request, request, reply
    const req1: Packet = {
      streamId,
      messageId: 30,
      isReply: false,
      payload: Buffer.from("req1"),
    };
    const req2: Packet = {
      streamId,
      messageId: 40,
      isReply: false,
      payload: Buffer.from("req2"),
    };
    const reply: Packet = {
      streamId,
      messageId: 1,
      isReply: true,
      payload: Buffer.from("reply1"),
    };

    writeRawPacket(child, req1);
    writeRawPacket(child, req2);
    writeRawPacket(child, reply);

    // receiveReply(1) will buffer both requests and return the reply
    const replyResult = stream.receiveReply(1);
    expect(replyResult).toEqual(Buffer.from("reply1"));

    // receiveRequest should return buffered request immediately (from queue)
    const [msgId1, payload1] = stream.receiveRequest();
    expect(msgId1).toBe(30);
    expect(payload1).toEqual(Buffer.from("req1"));

    // Second receiveRequest also from buffer
    const [msgId2, payload2] = stream.receiveRequest();
    expect(msgId2).toBe(40);
    expect(payload2).toEqual(Buffer.from("req2"));
  });
});

// ---------------------------------------------------------------------------
// Connection: readPacketForStream with cross-stream buffering
// ---------------------------------------------------------------------------

describe("Connection.readPacketForStream cross-stream buffering", () => {
  it("buffers packets for other streams", () => {
    const { connection, child } = createCatConnection();

    // Send packets for two different streams
    const packet1: Packet = {
      streamId: 100,
      messageId: 1,
      isReply: false,
      payload: Buffer.from("for-100"),
    };
    const packet2: Packet = {
      streamId: 200,
      messageId: 1,
      isReply: false,
      payload: Buffer.from("for-200"),
    };

    writeRawPacket(child, packet1);
    writeRawPacket(child, packet2);

    // Request packet for stream 200 - should buffer packet for stream 100
    const result = connection.readPacketForStream(200);
    expect(result.streamId).toBe(200);
    expect(result.payload).toEqual(Buffer.from("for-200"));

    // Now request packet for stream 100 - should come from inbox buffer
    const buffered = connection.readPacketForStream(100);
    expect(buffered.streamId).toBe(100);
    expect(buffered.payload).toEqual(Buffer.from("for-100"));
  });

  it("appends to existing inbox when multiple packets for same stream are buffered", () => {
    const { connection, child } = createCatConnection();

    // Send two packets for stream 100, then one for stream 200
    // When we read for stream 200, both stream-100 packets get buffered
    // in the same inbox array.
    const pkt1: Packet = {
      streamId: 100,
      messageId: 1,
      isReply: false,
      payload: Buffer.from("first-for-100"),
    };
    const pkt2: Packet = {
      streamId: 100,
      messageId: 2,
      isReply: false,
      payload: Buffer.from("second-for-100"),
    };
    const pkt3: Packet = {
      streamId: 200,
      messageId: 1,
      isReply: false,
      payload: Buffer.from("for-200"),
    };

    writeRawPacket(child, pkt1);
    writeRawPacket(child, pkt2);
    writeRawPacket(child, pkt3);

    // Reading for stream 200 buffers both stream-100 packets
    // First packet creates the inbox, second appends to existing inbox
    const result = connection.readPacketForStream(200);
    expect(result.streamId).toBe(200);

    // Both stream-100 packets should now be in the inbox
    const first = connection.readPacketForStream(100);
    expect(first.messageId).toBe(1);
    expect(first.payload).toEqual(Buffer.from("first-for-100"));

    const second = connection.readPacketForStream(100);
    expect(second.messageId).toBe(2);
    expect(second.payload).toEqual(Buffer.from("second-for-100"));
  });
});
