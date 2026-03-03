/**
 * Connection and Channel abstractions for the Hegel SDK.
 *
 * Implements a demand-driven multiplexed socket connection:
 * - {@link Connection} manages a single socket and routes packets to channels.
 * - {@link Channel} provides request/response messaging on a logical sub-channel.
 *
 * ## Reader model
 *
 * Reading is demand-driven: a Channel that needs a message calls
 * `connection.runReader(until)`. That function acquires a reader lock so only
 * one fiber drives the socket at a time. The reader loop calls `readPacket` and
 * dispatches each packet to the appropriate channel. To avoid blocking the event
 * loop forever, `readPacket` is wrapped with a socket-level timeout: we set
 * `socket.setTimeout(100)` before each read attempt and listen for the `timeout`
 * event, which lets us check `until()` periodically.
 *
 * @packageDocumentation
 */

import * as net from "net";
import {
  Packet,
  readPacket,
  writePacket,
  encodeValue,
  decodeValue,
  CLOSE_CHANNEL_PAYLOAD,
  CLOSE_CHANNEL_MESSAGE_ID,
  SocketIdleTimeoutError,
} from "./protocol.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default timeout for channel operations (milliseconds). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Handshake string sent by the client. */
const HANDSHAKE_STRING = Buffer.from("hegel_handshake_start");

/**
 * How long (ms) the reader loop waits for data before re-checking `until()`.
 * Must be short enough for timeouts to be responsive but not so short that
 * we spin-poll excessively.
 */
const READER_POLL_MS = 50;

// ---------------------------------------------------------------------------
// SHUTDOWN sentinel
// ---------------------------------------------------------------------------

/**
 * Sentinel value placed in a channel's inbox when the connection is closed.
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
  private readonly _channel: Channel;
  private readonly _messageId: number;
  private _value: unknown = _notSet;

  constructor(channel: Channel, messageId: number) {
    this._channel = channel;
    this._messageId = messageId;
  }

  /** Await the response (cached after first call). */
  async get(): Promise<unknown> {
    if (this._value === _notSet) {
      const raw = await this._channel.receiveResponseRaw(this._messageId);
      this._value = decodeValue(raw) as Record<string, unknown>;
    }
    return resultOrError(this._value as Record<string, unknown>);
  }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/**
 * Async-safe multiplexed socket connection.
 *
 * Uses a demand-driven reader: when a channel needs a message it calls
 * {@link Connection.runReader} which reads packets until the supplied
 * `until` predicate returns true.
 */
export class Connection {
  /** Human-readable name for debugging. */
  readonly name: string | undefined;

  /** Map from channel ID to Channel (or "dead" marker string). */
  readonly channels: Map<number, Channel | string> = new Map();

  private readonly _socket: net.Socket;
  private _running = true;
  private _nextChannelId = 0;
  private _connectionState: ConnectionState = ConnectionState.UNRESOLVED;
  private readonly _controlChannel: Channel;

  // Reader lock: only one async flow drives the read loop at a time.
  private _readerActive = false;
  // Writer lock: Promise chain that serialises writes.
  private _writerChain: Promise<void> = Promise.resolve();

  constructor(socket: net.Socket, opts: { name?: string } = {}) {
    this.name = opts.name;
    this._socket = socket;
    // Increase max listeners to accommodate the reader loop's timeout listeners.
    this._socket.setMaxListeners(50);
    // Channel 0 is the control channel — created before handshake.
    this._controlChannel = this._makeChannel(0);
  }

  /** True while the connection has not been closed. */
  get live(): boolean {
    return this._running;
  }

  /** The control channel (channel ID 0) used for handshaking. */
  get controlChannel(): Channel {
    return this._controlChannel;
  }

  // ---------------------------------------------------------------------------
  // Reader
  // ---------------------------------------------------------------------------

  /**
   * Drive the socket reader until `until()` returns true or the connection closes.
   *
   * Acquires the reader lock (only one async fiber runs the packet-read loop at
   * a time). If another fiber holds the lock, yields with short sleeps until
   * the lock is free or `until()` becomes true.
   *
   * @param until - Predicate; when it returns true, reading stops.
   */
  async runReader(until: () => boolean): Promise<void> {
    if (until()) return;

    // Spin-wait for the reader lock without blocking the event loop.
    while (this._readerActive) {
      if (until()) return;
      await sleep(1);
    }
    if (until()) return;

    this._readerActive = true;
    // Enable socket timeout so the read loop can poll `until()` periodically.
    this._socket.setTimeout(READER_POLL_MS);
    try {
      while (this._running && !until()) {
        let packet: Packet;
        try {
          packet = await readPacket(this._socket);
        } catch (e) {
          if (e instanceof SocketIdleTimeoutError) {
            // Idle timeout fired — just re-check `until()` and continue.
            continue;
          }
          // Real connection error (EOF, ECONNRESET, etc.) — stop the connection.
          this._running = false;
          this._notifyChannels();
          return;
        }
        this._dispatch(packet);
      }
    } finally {
      this._readerActive = false;
      // Clear the timeout so it doesn't fire outside the reader loop.
      this._socket.setTimeout(0);
    }
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  /**
   * Send a packet to the peer. Serialises concurrent writes via a chain of Promises.
   */
  sendPacket(packet: Packet): Promise<void> {
    this._writerChain = this._writerChain.then(() => writePacket(this._socket, packet));
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
      this._socket.destroy();
    } catch {
      // ignore
    }

    this._notifyChannels();
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

    const msgId = await this._controlChannel.sendRequestRaw(HANDSHAKE_STRING);
    const response = await this._controlChannel.receiveResponseRaw(msgId);
    const decoded = response.toString("utf-8");
    if (!decoded.startsWith("Hegel/")) {
      throw new Error(`Bad handshake response: ${JSON.stringify(decoded)}`);
    }
    return decoded.slice("Hegel/".length);
  }

  // ---------------------------------------------------------------------------
  // Channel creation
  // ---------------------------------------------------------------------------

  /**
   * Create a new logical channel on this connection (client-initiated).
   *
   * Channel IDs for clients are odd: `(counter << 1) | 1`.
   *
   * @throws {Error} If called before handshake.
   */
  newChannel(opts: { role?: string } = {}): Channel {
    if (this._connectionState === ConnectionState.UNRESOLVED) {
      throw new Error("Cannot create a new channel before handshake has been performed.");
    }
    const channelId = (this._nextChannelId << 1) | 1;
    this._nextChannelId++;
    return this._makeChannel(channelId, opts.role);
  }

  /**
   * Connect to a channel that was created by the peer.
   *
   * @throws {Error} If called before handshake, or channel already connected.
   */
  connectChannel(id: number, opts: { role?: string } = {}): Channel {
    if (this._connectionState === ConnectionState.UNRESOLVED) {
      throw new Error("Cannot create a new channel before handshake has been performed.");
    }
    if (this.channels.has(id)) {
      throw new Error(`Channel already connected as ${this.channels.get(id)}`);
    }
    return this._makeChannel(id, opts.role);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _makeChannel(id: number, role?: string): Channel {
    const ch = new Channel(this, id, role);
    this.channels.set(id, ch);
    return ch;
  }

  /** Dispatch a received packet to the correct channel. */
  private _dispatch(packet: Packet): void {
    // Close-channel message
    if (packet.payload.equals(CLOSE_CHANNEL_PAYLOAD)) {
      const existing = this.channels.get(packet.channelId);
      const deadName = existing instanceof Channel ? existing.name : `channel ${packet.channelId}`;
      this.channels.set(packet.channelId, `dead:${String(deadName)}`);
      return;
    }

    const channel = this.channels.get(packet.channelId);
    if (!(channel instanceof Channel)) {
      // Nonexistent or dead channel — send error reply if it was a request.
      if (!packet.isReply) {
        const error = `Message ${packet.messageId} sent to ${channel === undefined ? "non-existent" : "closed"} channel ${packet.channelId}`;
        this.sendPacket({
          channelId: packet.channelId,
          messageId: packet.messageId,
          isReply: true,
          payload: encodeValue({ error, type: "ChannelError" }),
        }).catch(() => {
          // ignore send errors during cleanup
        });
      }
      return;
    }

    channel.inbox.push(packet);
    channel._notifyWaiter();
  }

  /** Put SHUTDOWN into every open channel's inbox. */
  private _notifyChannels(): void {
    for (const v of this.channels.values()) {
      if (v instanceof Channel) {
        v.inbox.push(SHUTDOWN);
        v._notifyWaiter();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

/**
 * A logical communication channel over a {@link Connection}.
 */
export class Channel {
  /** Channel ID on the wire. */
  readonly channelId: number;
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

  constructor(connection: Connection, channelId: number, role?: string) {
    this.connection = connection;
    this.channelId = channelId;
    this.name = role ?? `channel ${channelId}`;
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

  /** Close this channel and notify the peer. Idempotent. */
  close(): void {
    if (this._closed) return;
    if (this.connection.channels.get(this.channelId) !== this) {
      this._closed = true;
      return;
    }
    this._closed = true;
    if (this.connection.live) {
      this.connection
        .sendPacket({
          payload: CLOSE_CHANNEL_PAYLOAD,
          messageId: CLOSE_CHANNEL_MESSAGE_ID,
          channelId: this.channelId,
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
      channelId: this.channelId,
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
        channelId: this.channelId,
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
      channelId: this.channelId,
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
   * Drive the connection reader until `ready()` becomes true, then drain the
   * inbox into `requests` and `responses` queues.
   *
   * Two modes of waking:
   * 1. `runReader` dispatches a packet, which calls `_notifyWaiter()`.
   * 2. The timeout deadline fires.
   *
   * We use a waiter Promise that resolves when `_notifyWaiter` is called or
   * when the deadline fires.
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

    // Track whether this wait has been satisfied, so runReader releases its lock
    // promptly when data arrives (without holding it until the deadline).
    let satisfied = false;

    // until() for the reader: stop when data arrives, closed, or timed out.
    const until = (): boolean => {
      if (satisfied) return true;
      if (this._closed) return true;
      if (Date.now() >= deadline) return true;
      return false;
    };

    // Kick off the reader in the background, but also wait for it via a waiter.
    // The reader dispatches packets which call _notifyWaiter(). We wake up,
    // drain the inbox, and check if we're done.
    while (!until()) {
      // Start the reader (if not already active).
      const readerPromise = this.connection.runReader(until);

      // Wait to be notified OR for the deadline.
      await Promise.race([
        readerPromise,
        new Promise<void>((resolve) => {
          this._waiter = resolve;
          // Fallback timeout: wake on deadline to re-check until().
          setTimeout(resolve, Math.max(1, deadline - Date.now()));
        }),
      ]);

      // Clear stale waiter.
      this._waiter = null;

      this._drainInbox();
      if (ready()) {
        satisfied = true;
        return;
      }
    }

    // Final drain and check after loop exit.
    this._drainInbox();

    if (this._closed) {
      // Distinguish SHUTDOWN (connection drop) from explicit channel close.
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

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
