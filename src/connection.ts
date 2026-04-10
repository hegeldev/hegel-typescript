/**
 * Connection and Stream abstractions for the Hegel library.
 *
 * - {@link Connection} manages a pair of streams (reader + writer) and routes
 *   packets to logical sub-streams.
 * - {@link Stream} provides request/response messaging on a logical sub-stream.
 *
 * ## Reader model
 *
 * A background async loop reads packets continuously from the reader stream and
 * dispatches them to the appropriate {@link Stream} inbox. Streams wait for data
 * via a simple notification promise — no reader lock or polling is needed.
 *
 * @packageDocumentation
 */

import * as stream from "node:stream";
import {
  Packet,
  readPacket,
  writePacket,
  encodeValue,
  decodeValue,
  CLOSE_STREAM_PAYLOAD,
  CLOSE_STREAM_MESSAGE_ID,
} from "./protocol.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default timeout for stream operations (milliseconds). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Handshake string sent by the client. */
const HANDSHAKE_STRING = Buffer.from("hegel_handshake_start");

// ---------------------------------------------------------------------------
// SHUTDOWN sentinel
// ---------------------------------------------------------------------------

/**
 * Sentinel value placed in a stream's inbox when the connection is closed.
 * Causes any waiting `receiveRequest` / `receiveResponse` to throw.
 */
export const SHUTDOWN: unique symbol = Symbol("SHUTDOWN");
export type Shutdown = typeof SHUTDOWN;

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

/** Connection state: unresolved (pre-handshake) or client. */
export enum ConnectionState {
  UNRESOLVED = 0,
  CLIENT = 1,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Error response received from the peer.
 *
 * Wraps a CBOR dict containing `{ error, type, ...extra }`.
 */
export class RequestError extends Error {
  /** The error type name reported by the peer. */
  readonly errorType: string;
  /** Any extra fields from the error dict. */
  readonly data: Record<string, unknown>;

  constructor(data: Record<string, unknown>) {
    const msg = data["error"] as string;
    const errorType = data["type"] as string;
    const rest = { ...data };
    delete rest["error"];
    delete rest["type"];
    super(msg);
    this.name = "RequestError";
    this.errorType = errorType;
    this.data = rest;
  }
}

/**
 * Extract the `result` field from a CBOR response dict, or throw {@link RequestError}.
 *
 * @param body - Decoded CBOR dict with either a `result` or `error` key.
 */
export function resultOrError(body: Record<string, unknown>): unknown {
  if ("error" in body) {
    throw new RequestError(body);
  }
  return body["result"];
}

// ---------------------------------------------------------------------------
// PendingRequest
// ---------------------------------------------------------------------------

const _notSet: unique symbol = Symbol("notSet");

/**
 * Handle for an in-flight request. Caches the result after first resolution.
 */
export class PendingRequest {
  private readonly _stream: Stream;
  private readonly _messageId: number;
  private _value: unknown = _notSet;

  constructor(stream: Stream, messageId: number) {
    this._stream = stream;
    this._messageId = messageId;
  }

  /** Await the response (cached after first call). */
  async get(): Promise<unknown> {
    if (this._value === _notSet) {
      const raw = await this._stream.receiveResponseRaw(this._messageId);
      this._value = decodeValue(raw) as Record<string, unknown>;
    }
    return resultOrError(this._value as Record<string, unknown>);
  }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/**
 * Multiplexed connection over a pair of readable/writable streams.
 *
 * A background async loop reads packets from the reader and dispatches them
 * to the appropriate {@link Stream}. Writes are serialised via a Promise chain.
 */
export class Connection {
  /** Human-readable name for debugging. */
  readonly name: string | undefined;

  /** Map from stream ID to Stream (or "dead" marker string). */
  readonly streams: Map<number, Stream | string> = new Map();

  private readonly _reader: stream.Readable;
  private readonly _writer: stream.Writable;
  private _running = true;
  private _nextStreamId = 0;
  private _connectionState: ConnectionState = ConnectionState.UNRESOLVED;
  private readonly _controlStream: Stream;

  // Writer lock: Promise chain that serialises writes.
  private _writerChain: Promise<void> = Promise.resolve();

  constructor(reader: stream.Readable, writer: stream.Writable, opts: { name?: string } = {}) {
    this.name = opts.name;
    this._reader = reader;
    this._writer = writer;
    // Stream 0 is the control stream — created before handshake.
    this._controlStream = this._makeStream(0);
    // Start the background reader loop immediately.
    // _readLoop catches all errors internally, so the promise never rejects.
    this._readLoop();
  }

  /** True while the connection has not been closed. */
  get live(): boolean {
    return this._running;
  }

  /** The control stream (stream ID 0) used for handshaking. */
  get controlStream(): Stream {
    return this._controlStream;
  }

  // ---------------------------------------------------------------------------
  // Reader
  // ---------------------------------------------------------------------------

  /**
   * Background reader loop. Reads packets continuously and dispatches them
   * to the appropriate stream. Runs until the connection is closed or the
   * reader stream ends/errors.
   */
  private async _readLoop(): Promise<void> {
    try {
      while (this._running) {
        const packet = await readPacket(this._reader);
        this._dispatch(packet);
      }
    } catch {
      // EOF, ECONNRESET, or stream destroyed — connection is dead.
      this._running = false;
      this._notifyStreams();
    }
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  /**
   * Send a packet to the peer. Serialises concurrent writes via a chain of Promises.
   */
  sendPacket(packet: Packet): Promise<void> {
    this._writerChain = this._writerChain.then(() => writePacket(this._writer, packet));
    return this._writerChain;
  }

  // ---------------------------------------------------------------------------
  // Close
  // ---------------------------------------------------------------------------

  /** Close the connection and clean up. Idempotent. */
  close(): void {
    if (!this._running) return;
    this._running = false;

    try {
      this._reader.destroy();
    } catch {
      // ignore
    }
    // Guard against reader === writer (e.g. when constructed from a duplex socket in tests).
    if (this._writer !== (this._reader as unknown)) {
      try {
        this._writer.destroy();
      } catch {
        // ignore
      }
    }

    this._notifyStreams();
  }

  // ---------------------------------------------------------------------------
  // Handshake
  // ---------------------------------------------------------------------------

  /**
   * Initiate handshake as a client. Returns the server's version string.
   *
   * @throws {Error} If handshake was already performed, or the server replies badly.
   */
  async sendHandshake(): Promise<string> {
    if (this._connectionState !== ConnectionState.UNRESOLVED) {
      throw new Error("Handshake already established");
    }
    this._connectionState = ConnectionState.CLIENT;

    const msgId = await this._controlStream.sendRequestRaw(HANDSHAKE_STRING);
    const response = await this._controlStream.receiveResponseRaw(msgId);
    const decoded = response.toString("utf-8");
    if (!decoded.startsWith("Hegel/")) {
      throw new Error(`Bad handshake response: ${JSON.stringify(decoded)}`);
    }
    return decoded.slice("Hegel/".length);
  }

  // ---------------------------------------------------------------------------
  // Stream creation
  // ---------------------------------------------------------------------------

  /**
   * Create a new logical stream on this connection (client-initiated).
   *
   * Stream IDs for clients are odd: `(counter << 1) | 1`.
   *
   * @throws {Error} If called before handshake.
   */
  newStream(opts: { role?: string } = {}): Stream {
    if (this._connectionState === ConnectionState.UNRESOLVED) {
      throw new Error("Cannot create a new stream before handshake has been performed.");
    }
    const streamId = (this._nextStreamId << 1) | 1;
    this._nextStreamId++;
    return this._makeStream(streamId, opts.role);
  }

  /**
   * Connect to a stream that was created by the peer.
   *
   * @throws {Error} If called before handshake, or stream already connected.
   */
  connectStream(id: number, opts: { role?: string } = {}): Stream {
    if (this._connectionState === ConnectionState.UNRESOLVED) {
      throw new Error("Cannot create a new stream before handshake has been performed.");
    }
    if (this.streams.has(id)) {
      throw new Error(`Stream already connected as ${this.streams.get(id)}`);
    }
    return this._makeStream(id, opts.role);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _makeStream(id: number, role?: string): Stream {
    const ch = new Stream(this, id, role);
    this.streams.set(id, ch);
    return ch;
  }

  /** Dispatch a received packet to the correct stream. */
  private _dispatch(packet: Packet): void {
    // Close-stream message
    if (packet.payload.equals(CLOSE_STREAM_PAYLOAD)) {
      const existing = this.streams.get(packet.streamId);
      const deadName = existing instanceof Stream ? existing.name : `stream ${packet.streamId}`;
      this.streams.set(packet.streamId, `dead:${String(deadName)}`);
      return;
    }

    const stream = this.streams.get(packet.streamId);
    if (!(stream instanceof Stream)) {
      // Nonexistent or dead stream — send error reply if it was a request.
      if (!packet.isReply) {
        const error = `Message ${packet.messageId} sent to ${stream === undefined ? "non-existent" : "closed"} stream ${packet.streamId}`;
        this.sendPacket({
          streamId: packet.streamId,
          messageId: packet.messageId,
          isReply: true,
          payload: encodeValue({ error, type: "StreamError" }),
        }).catch(() => {
          // ignore send errors during cleanup
        });
      }
      return;
    }

    stream.inbox.push(packet);
    stream._notifyWaiter();
  }

  /** Put SHUTDOWN into every open stream's inbox. */
  private _notifyStreams(): void {
    for (const v of this.streams.values()) {
      if (v instanceof Stream) {
        v.inbox.push(SHUTDOWN);
        v._notifyWaiter();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

/**
 * A logical communication stream over a {@link Connection}.
 */
export class Stream {
  /** Stream ID on the wire. */
  readonly streamId: number;
  /** Human-readable role label. */
  readonly name: string | undefined;

  /** Inbox: packets and SHUTDOWN sentinels waiting to be consumed. */
  readonly inbox: Array<Packet | Shutdown> = [];

  /** Pending responses keyed by message ID. */
  readonly responses: Map<number, Buffer> = new Map();

  /** Pending requests (server-initiated) waiting to be consumed. */
  readonly requests: Array<Packet> = [];

  readonly connection: Connection;

  /** Next outgoing message ID. */
  private _nextMessageId = 1;

  private _closed = false;

  // When an async caller is waiting for inbox data, its wakeup lives here.
  private _waiter: (() => void) | null = null;

  constructor(connection: Connection, streamId: number, role?: string) {
    this.connection = connection;
    this.streamId = streamId;
    this.name = role ?? `stream ${streamId}`;
  }

  /** Notify a waiter (if any) that new data arrived in the inbox. */
  _notifyWaiter(): void {
    if (this._waiter) {
      const w = this._waiter;
      this._waiter = null;
      w();
    }
  }

  // ---------------------------------------------------------------------------
  // Close
  // ---------------------------------------------------------------------------

  /** Close this stream and notify the peer. Idempotent. */
  close(): void {
    if (this._closed) return;
    if (this.connection.streams.get(this.streamId) !== this) {
      this._closed = true;
      return;
    }
    this._closed = true;
    if (this.connection.live) {
      this.connection
        .sendPacket({
          payload: CLOSE_STREAM_PAYLOAD,
          messageId: CLOSE_STREAM_MESSAGE_ID,
          streamId: this.streamId,
          isReply: false,
        })
        .catch(() => {
          // ignore errors when closing
        });
    }
  }

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------

  /** Send a CBOR-encoded request. Returns the message ID. */
  async sendRequest(message: unknown): Promise<number> {
    return this.sendRequestRaw(encodeValue(message));
  }

  /** Send a raw bytes request. Returns the message ID. */
  async sendRequestRaw(message: Buffer): Promise<number> {
    const messageId = this._nextMessageId++;
    await this.connection.sendPacket({
      payload: message,
      streamId: this.streamId,
      isReply: false,
      messageId,
    });
    return messageId;
  }

  /**
   * Send a request and return a {@link PendingRequest} handle.
   * The message ID is allocated synchronously; the send is queued immediately.
   */
  request(message: unknown): PendingRequest {
    const messageId = this._nextMessageId++;
    this.connection
      .sendPacket({
        payload: encodeValue(message),
        streamId: this.streamId,
        isReply: false,
        messageId,
      })
      .catch(() => {});
    return new PendingRequest(this, messageId);
  }

  // ---------------------------------------------------------------------------
  // Receive
  // ---------------------------------------------------------------------------

  /** Receive a server-initiated request. Returns `[messageId, decodedBody]`. */
  async receiveRequest(opts: { timeoutMs?: number } = {}): Promise<[number, unknown]> {
    const [msgId, raw] = await this.receiveRequestRaw(opts);
    return [msgId, decodeValue(raw)];
  }

  /** Receive a server-initiated request as raw bytes. Returns `[messageId, payload]`. */
  async receiveRequestRaw(opts: { timeoutMs?: number } = {}): Promise<[number, Buffer]> {
    await this._waitForMessage(
      () => this.requests.length > 0,
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const pkt = this.requests.shift()!;
    return [pkt.messageId, pkt.payload];
  }

  /** Receive a response and extract the `result` field (throws on error response). */
  async receiveResponse(messageId: number, opts: { timeoutMs?: number } = {}): Promise<unknown> {
    const raw = await this.receiveResponseRaw(messageId, opts);
    const body = decodeValue(raw) as Record<string, unknown>;
    return resultOrError(body);
  }

  /** Receive a response as raw bytes. */
  async receiveResponseRaw(messageId: number, opts: { timeoutMs?: number } = {}): Promise<Buffer> {
    await this._waitForMessage(
      () => this.responses.has(messageId),
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const buf = this.responses.get(messageId)!;
    this.responses.delete(messageId);
    return buf;
  }

  // ---------------------------------------------------------------------------
  // Send replies
  // ---------------------------------------------------------------------------

  /** Send a raw bytes reply. */
  async sendResponseRaw(messageId: number, message: Buffer): Promise<void> {
    await this.connection.sendPacket({
      payload: message,
      streamId: this.streamId,
      isReply: true,
      messageId,
    });
  }

  /** Send a CBOR-encoded `{ result: value }` reply. */
  async sendResponseValue(messageId: number, value: unknown): Promise<void> {
    await this.sendResponseRaw(messageId, encodeValue({ result: value }));
  }

  // ---------------------------------------------------------------------------
  // Internal: wait for inbox data
  // ---------------------------------------------------------------------------

  /**
   * Wait until `ready()` becomes true, draining the inbox between wakeups.
   *
   * The background reader loop dispatches packets and calls `_notifyWaiter()`
   * when new data arrives. This method simply waits for that notification or
   * the timeout deadline.
   */
  private async _waitForMessage(ready: () => boolean, timeoutMs: number): Promise<void> {
    if (this._closed) {
      throw new Error(`${this.name} is closed`);
    }

    // Drain any already-buffered data.
    this._drainInbox();
    if (ready()) return;

    // Check for pre-existing SHUTDOWN.
    if (this._closed) throw new Error("Connection closed");

    const deadline = Date.now() + timeoutMs;

    while (!this._closed) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      // Wait for _notifyWaiter() or the deadline, whichever comes first.
      await new Promise<void>((resolve) => {
        this._waiter = resolve;
        setTimeout(resolve, remaining);
      });
      this._waiter = null;

      this._drainInbox();
      if (ready()) return;
    }

    // Final drain after loop exit.
    this._drainInbox();

    if (this._closed) {
      // Distinguish SHUTDOWN (connection drop) from explicit stream close.
      if (this.inbox.length > 0 && this.inbox[0] === SHUTDOWN) {
        throw new Error("Connection closed");
      }
      throw new Error(`${this.name} is closed`);
    }

    // Loop exited due to deadline — the data never arrived.
    throw new Error(`Timed out after ${timeoutMs}ms waiting for a message on ${this.name}`);
  }

  /** Drain the inbox into requests/responses queues. Sets `_closed` on SHUTDOWN. */
  private _drainInbox(): void {
    while (this.inbox.length > 0) {
      const item = this.inbox[0];
      if (item === SHUTDOWN) {
        this._closed = true;
        return;
      }
      this.inbox.shift();
      const pkt = item as Packet;
      if (pkt.isReply) {
        this.responses.set(pkt.messageId, pkt.payload);
      } else {
        this.requests.push(pkt);
      }
    }
  }
}
