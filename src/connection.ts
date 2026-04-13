/**
 * Synchronous connection and stream multiplexing over stdio pipes.
 *
 * The Connection reads/writes raw bytes via file descriptors using
 * `fs.readSync`/`fs.writeSync`. The Stream class provides request/reply
 * semantics with CBOR encoding on top.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import {
  type Packet,
  encodePacket,
  readPacketFrom,
  encodeValue,
  decodeValue,
  CLOSE_STREAM_MESSAGE_ID,
  CLOSE_STREAM_PAYLOAD,
} from "./protocol.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Sleep helper (for EAGAIN retry on non-blocking fds)
// ---------------------------------------------------------------------------

const sleepArray = new Int32Array(new SharedArrayBuffer(4));

function sleepMs(ms: number): void {
  Atomics.wait(sleepArray, 0, 0, ms);
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export class Connection {
  private readFd: number;
  private writeFd: number;
  private nextStreamCounter = 0;
  private streamInboxes = new Map<number, Packet[]>();
  private serverExited = false;

  constructor(readFd: number, writeFd: number) {
    this.readFd = readFd;
    this.writeFd = writeFd;
  }

  markServerExited(): void {
    this.serverExited = true;
  }

  hasServerExited(): boolean {
    return this.serverExited;
  }

  /**
   * Read exactly `n` bytes from the pipe, blocking until available.
   * Handles EAGAIN from non-blocking file descriptors.
   */
  readExact(n: number): Buffer {
    const buf = Buffer.alloc(n);
    let offset = 0;
    while (offset < n) {
      try {
        const bytesRead = fs.readSync(this.readFd, buf, offset, n - offset, null);
        if (bytesRead === 0) {
          this.serverExited = true;
          throw new Error("Connection closed: server process exited");
        }
        offset += bytesRead;
      } catch (e: unknown) {
        if (
          e instanceof Error &&
          "code" in e &&
          ((e as NodeJS.ErrnoException).code === "EAGAIN" ||
            (e as NodeJS.ErrnoException).code === "EWOULDBLOCK")
        ) {
          sleepMs(1);
          continue;
        }
        throw e;
      }
    }
    return buf;
  }

  /**
   * Write a packet to the server synchronously.
   */
  sendPacket(packet: Packet): void {
    const data = encodePacket(packet);
    fs.writeSync(this.writeFd, data);
  }

  /**
   * Read packets until one for the given stream arrives.
   * Packets for other streams are buffered in their inboxes.
   */
  readPacketForStream(streamId: number): Packet {
    // Check inbox first
    const inbox = this.streamInboxes.get(streamId);
    if (inbox && inbox.length > 0) {
      return inbox.shift()!;
    }

    // Read from pipe until we get a packet for this stream
    while (true) {
      const packet = readPacketFrom((n) => this.readExact(n));

      if (packet.streamId === streamId) {
        return packet;
      }

      // Buffer for other streams
      let otherInbox = this.streamInboxes.get(packet.streamId);
      if (!otherInbox) {
        otherInbox = [];
        this.streamInboxes.set(packet.streamId, otherInbox);
      }
      otherInbox.push(packet);
    }
  }

  /**
   * Create a new client-initiated stream (odd ID).
   */
  newStream(): Stream {
    const id = ((this.nextStreamCounter++ << 1) | 1) >>> 0;
    return new Stream(id, this);
  }

  /**
   * Connect to an existing server-allocated stream.
   */
  connectStream(streamId: number): Stream {
    return new Stream(streamId, this);
  }

  /**
   * Get the control stream (stream ID 0).
   */
  controlStream(): Stream {
    return new Stream(0, this);
  }

  /**
   * Remove buffered packets for a stream.
   */
  unregisterStream(streamId: number): void {
    this.streamInboxes.delete(streamId);
  }
}

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

export class Stream {
  readonly streamId: number;
  private connection: Connection;
  private nextMessageId = 1;
  private responses = new Map<number, Buffer>();
  private requests: Packet[] = [];
  private closed = false;

  constructor(streamId: number, connection: Connection) {
    this.streamId = streamId;
    this.connection = connection;
  }

  markClosed(): void {
    this.closed = true;
  }

  private checkClosed(): void {
    if (this.closed) {
      throw new Error("Stream is closed");
    }
  }

  /**
   * Send a request packet and return the message ID.
   */
  sendRequest(payload: Buffer): number {
    this.checkClosed();
    const messageId = this.nextMessageId++;
    this.connection.sendPacket({
      streamId: this.streamId,
      messageId,
      isReply: false,
      payload,
    });
    return messageId;
  }

  /**
   * Send a reply to an incoming request.
   */
  writeReply(messageId: number, payload: Buffer): void {
    this.connection.sendPacket({
      streamId: this.streamId,
      messageId,
      isReply: true,
      payload,
    });
  }

  /**
   * Wait for a reply to a previously sent request.
   */
  receiveReply(messageId: number): Buffer {
    // Check buffered responses first
    const buffered = this.responses.get(messageId);
    if (buffered !== undefined) {
      this.responses.delete(messageId);
      return buffered;
    }

    while (true) {
      this.checkClosed();
      const packet = this.connection.readPacketForStream(this.streamId);

      if (packet.isReply && packet.messageId === messageId) {
        return packet.payload;
      }

      // Buffer for later
      if (packet.isReply) {
        this.responses.set(packet.messageId, packet.payload);
      } else {
        this.requests.push(packet);
      }
    }
  }

  /**
   * Wait for an incoming request from the server.
   */
  receiveRequest(): [number, Buffer] {
    if (this.requests.length > 0) {
      const packet = this.requests.shift()!;
      return [packet.messageId, packet.payload];
    }

    while (true) {
      this.checkClosed();
      const packet = this.connection.readPacketForStream(this.streamId);

      if (!packet.isReply) {
        return [packet.messageId, packet.payload];
      }

      // Buffer reply for later
      this.responses.set(packet.messageId, packet.payload);
    }
  }

  /**
   * Send a CBOR-encoded request and return the decoded CBOR response.
   * Checks for error responses from the server.
   */
  requestCbor(message: unknown): unknown {
    const payload = encodeValue(message);
    const id = this.sendRequest(payload);
    const responseBytes = this.receiveReply(id);
    const response = decodeValue(responseBytes) as Record<string, unknown> | unknown;

    if (!isRecord(response)) return response;

    if ("error" in response) {
      const errorType = response["type"] ?? "";
      throw new Error(`Server error (${errorType}): ${JSON.stringify(response["error"])}`);
    }

    if ("result" in response) {
      return response["result"];
    }

    return response;
  }

  /**
   * Close this stream gracefully.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connection.unregisterStream(this.streamId);
    this.connection.sendPacket({
      streamId: this.streamId,
      messageId: CLOSE_STREAM_MESSAGE_ID,
      isReply: false,
      payload: CLOSE_STREAM_PAYLOAD,
    });
  }
}
