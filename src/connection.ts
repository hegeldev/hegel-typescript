/**
 * Connection and Channel abstractions for the Hegel SDK.
 *
 * Implements a demand-driven multiplexed socket connection where reading is
 * triggered by the channel that needs data, avoiding background threads.
 *
 * @packageDocumentation
 */

import * as net from "net";
import { decode as cborDecode, encode as cborEncode } from "cbor2";
import {
  CLOSE_CHANNEL_MESSAGE_ID,
  CLOSE_CHANNEL_PAYLOAD,
  PROTOCOL_VERSION,
  Packet,
  readPacket,
  writePacket,
} from "./protocol.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Handshake bytes sent by the client to initiate the connection. */
export const HANDSHAKE_STRING = Buffer.from("hegel_handshake_start");

/** Default channel operation timeout in seconds. */
const CHANNEL_TIMEOUT = 30;

/** Reader poll interval in milliseconds when waiting for the reader lock. */
const READER_POLL_MS = 1;

/** Short socket read timeout in milliseconds for the demand-driven reader. */
const READ_TIMEOUT_MS = 100;

// ---------------------------------------------------------------------------
// Sentinel value
// ---------------------------------------------------------------------------

/**
 * Sentinel value pushed into channel inboxes when the connection closes.
 * Causes blocked `receiveRequest` / `receiveResponseRaw` calls to throw.
 */
export const SHUTDOWN: unique symbol = Symbol("SHUTDOWN");

/** Type for values that can appear in a channel's inbox. */
export type InboxItem = Packet | typeof SHUTDOWN;

// ---------------------------------------------------------------------------
// Connection state enum
// ---------------------------------------------------------------------------

const enum ConnectionState {
  UNRESOLVED = 0,
  CLIENT = 1,
  SERVER = 2,
}

// ---------------------------------------------------------------------------
// DeadChannel marker
// ---------------------------------------------------------------------------

/**
 * Replaces a channel entry after it has been closed, for debugging.
 */
export interface DeadChannel {
  readonly kind: "dead";
  readonly channelId: number;
  readonly name: string;
}

function makeDeadChannel(channelId: number, name: string): DeadChannel {
  return { kind: "dead", channelId, name };
}

function isDeadChannel(v: unknown): v is DeadChannel {
  return (
    v !== null && typeof v === "object" && (v as DeadChannel).kind === "dead"
  );
}

// ---------------------------------------------------------------------------
// RequestError
// ---------------------------------------------------------------------------

/**
 * Error response received from the peer.
 */
export class RequestError extends Error {
  /** The error type string sent by the peer. */
  errorType: string;
  /** Any remaining fields from the error payload. */
  data: Record<string, unknown>;

  constructor(payload: Record<string, unknown>) {
    const msg = payload["error"] as string;
    super(msg);
    this.name = "RequestError";
    this.errorType = payload["type"] as string;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { error: _error, type: _type, ...rest } = payload;
    this.data = rest;
  }
}

/**
 * Unwrap a CBOR result dict, throwing {@link RequestError} if an error
 * key is present.
 *
 * @param body - Decoded CBOR object with either `result` or `error` key.
 * @returns The `result` value.
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

/**
 * Future-like handle for an in-flight request.
 */
export class PendingRequest {
  private readonly channel: Channel;
  private readonly messageId: number;
  private cachedValue: unknown = NOT_SET;

  constructor(channel: Channel, messageId: number) {
    this.channel = channel;
    this.messageId = messageId;
  }

  /**
   * Wait for and return the response.
   * The result is cached — calling `get()` multiple times returns the same value.
   */
  async get(): Promise<unknown> {
    if (this.cachedValue === NOT_SET) {
      const raw = await this.channel.receiveResponseRaw(this.messageId);
      this.cachedValue = resultOrError(
        cborDecode(raw) as Record<string, unknown>,
      );
    }
    return this.cachedValue;
  }
}

const NOT_SET: unique symbol = Symbol("NOT_SET");

// ---------------------------------------------------------------------------
// Connection options
// ---------------------------------------------------------------------------

export interface ConnectionOptions {
  name?: string;
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/**
 * Multiplexed socket connection to a Hegel peer.
 *
 * Uses a demand-driven reader: reading from the socket is triggered by the
 * channel that needs data, so no background threads are required.
 */
export class Connection {
  readonly name: string | undefined;

  private readonly socket: net.Socket;
  private nextChannelId = 1;
  /** Map from channel ID to Channel or DeadChannel. */
  readonly channels: Map<number, Channel | DeadChannel> = new Map();
  private running = true;
  private connectionState: ConnectionState = ConnectionState.UNRESOLVED;

  /** Mutex flag for the writer (true = locked). */
  private writerLocked = false;
  /** Mutex flag for the reader (true = locked). */
  private readerLocked = false;

  private readonly _controlChannel: Channel;

  constructor(socket: net.Socket, options: ConnectionOptions = {}) {
    this.name = options.name;
    this.socket = socket;
    // Control channel is always channel 0
    this._controlChannel = this._allocChannel(0);
  }

  /** Allocate a channel at a specific ID (used for channel 0 at startup). */
  private _allocChannel(id: number, role?: string): Channel {
    const ch = new Channel(this, id, role);
    this.channels.set(id, ch);
    return ch;
  }

  /** Whether the connection is alive. */
  get live(): boolean {
    return this.running;
  }

  /** The control channel (channel 0) used for handshaking. */
  get controlChannel(): Channel {
    return this._controlChannel;
  }

  // -------------------------------------------------------------------------
  // Reader (demand-driven)
  // -------------------------------------------------------------------------

  /**
   * Run the reader loop until `until()` returns true.
   *
   * Acquires a reader lock non-blockingly: if another caller holds the lock,
   * polls every 1 ms until `until()` is satisfied or the
   * lock becomes available.
   */
  async runReader(until: () => boolean): Promise<void> {
    if (until()) return;

    let acquired = false;
    try {
      // Spin waiting for the reader lock (non-blocking acquire)
      while (true) {
        if (!this.readerLocked) {
          this.readerLocked = true;
          acquired = true;
          break;
        }
        if (until()) return;
        await sleep(READER_POLL_MS);
      }

      // Hold the lock and read packets
      while (this.running && !until()) {
        let packet: Packet;
        try {
          packet = await readPacketWithTimeout(this.socket, READ_TIMEOUT_MS);
        } catch (e) {
          if (e instanceof TimeoutError) continue;
          // Connection closed — stop
          break;
        }
        this._dispatch(packet);
      }
    } finally {
      if (acquired) {
        this.readerLocked = false;
      }
    }
  }

  /** Dispatch a received packet to the correct channel's inbox. */
  private _dispatch(packet: Packet): void {
    const entry = this.channels.get(packet.channelId);

    if (
      Buffer.compare(packet.payload, CLOSE_CHANNEL_PAYLOAD) === 0 &&
      packet.messageId === CLOSE_CHANNEL_MESSAGE_ID
    ) {
      // Channel close notification
      const name =
        entry && !isDeadChannel(entry)
          ? (entry.role ?? `channel ${packet.channelId}`)
          : `channel ${packet.channelId}`;
      this.channels.set(
        packet.channelId,
        makeDeadChannel(packet.channelId, name),
      );
      return;
    }

    if (entry === undefined || isDeadChannel(entry)) {
      // Unknown or closed channel — send an error reply for non-reply packets
      const errType = entry === undefined ? "non-existent" : "closed";
      const channelName = `channel ${packet.channelId}`;
      const errMsg = `Message ${packet.messageId} sent to ${errType} ${channelName}`;
      if (!packet.isReply) {
        void this.sendPacket({
          channelId: packet.channelId,
          messageId: packet.messageId,
          isReply: true,
          payload: Buffer.from(cborEncode({ error: errMsg })),
        });
      }
    } else {
      entry.inbox.push(packet);
    }
  }

  // -------------------------------------------------------------------------
  // Writer
  // -------------------------------------------------------------------------

  /**
   * Send a packet to the peer (serialised with a writer lock).
   */
  async sendPacket(packet: Packet): Promise<void> {
    // Acquire writer lock
    while (this.writerLocked) {
      await sleep(READER_POLL_MS);
    }
    this.writerLocked = true;
    try {
      await writePacket(this.socket, packet);
    } finally {
      this.writerLocked = false;
    }
  }

  // -------------------------------------------------------------------------
  // Close
  // -------------------------------------------------------------------------

  /**
   * Close the connection and clean up resources.
   * Idempotent — safe to call multiple times.
   */
  close(): void {
    if (!this.running) return;
    this.running = false;

    try {
      this.socket.destroy();
    } catch {
      // ignore
    }

    // Signal all open channels
    for (const v of this.channels.values()) {
      if (!isDeadChannel(v)) {
        v.inbox.push(SHUTDOWN);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Handshake
  // -------------------------------------------------------------------------

  /**
   * Initiate handshake as a client.
   * @returns The server version string (e.g. `"0.1"`).
   */
  async sendHandshake(): Promise<string> {
    if (this.connectionState !== ConnectionState.UNRESOLVED) {
      throw new Error("Handshake already established");
    }
    this.connectionState = ConnectionState.CLIENT;

    const msgId = await this._controlChannel.sendRequestRaw(HANDSHAKE_STRING);
    const response = await this._controlChannel.receiveResponseRaw(msgId);
    const decoded = response.toString("utf8");
    if (!decoded.startsWith("Hegel/")) {
      throw new Error(`Bad handshake response: ${JSON.stringify(decoded)}`);
    }
    return decoded.slice("Hegel/".length);
  }

  /**
   * Accept a handshake as a server.
   */
  async receiveHandshake(): Promise<void> {
    if (this.connectionState !== ConnectionState.UNRESOLVED) {
      throw new Error("Handshake already established");
    }
    this.connectionState = ConnectionState.SERVER;

    const [msgId, payload] = await this._controlChannel.receiveRequestRaw();
    if (Buffer.compare(payload, HANDSHAKE_STRING) !== 0) {
      throw new Error(
        `Bad handshake: expected ${JSON.stringify(HANDSHAKE_STRING.toString())}, got ${JSON.stringify(payload.toString())}`,
      );
    }
    await this._controlChannel.sendResponseRaw(
      msgId,
      Buffer.from(`Hegel/${PROTOCOL_VERSION}`),
    );
  }

  // -------------------------------------------------------------------------
  // Channel allocation
  // -------------------------------------------------------------------------

  /**
   * Create a new logical channel on this connection.
   * Client channels receive odd IDs; server channels receive even IDs.
   */
  newChannel(options: { role?: string } = {}): Channel {
    if (
      this.channels.size > 0 &&
      this.connectionState === ConnectionState.UNRESOLVED
    ) {
      throw new Error(
        "Cannot create a new channel before handshake has been performed.",
      );
    }
    const id =
      (this.nextChannelId++ << 1) |
      (this.connectionState === ConnectionState.CLIENT ? 1 : 0);
    return this._allocChannel(id, options.role);
  }

  /**
   * Connect to a channel that was created by the peer.
   *
   * @param id - The channel ID assigned by the peer.
   */
  connectChannel(id: number, options: { role?: string } = {}): Channel {
    if (this.connectionState === ConnectionState.UNRESOLVED) {
      throw new Error(
        "Cannot create a new channel before handshake has been performed.",
      );
    }
    if (this.channels.has(id)) {
      throw new Error(
        `Channel already connected as ${String(this.channels.get(id))}.`,
      );
    }
    return this._allocChannel(id, options.role);
  }
}

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

export interface ReceiveOptions {
  timeout?: number;
}

/**
 * Logical channel for request/response messaging.
 *
 * Not thread-safe — each channel should be used from a single async context.
 */
export class Channel {
  readonly channelId: number;
  readonly connection: Connection;
  readonly role: string | undefined;

  /** Queue of packets waiting to be processed by this channel. */
  readonly inbox: InboxItem[] = [];
  /** Pending incoming requests (not yet consumed by the application). */
  readonly requests: Packet[] = [];
  /** Received responses keyed by message ID. */
  readonly responses: Map<number, Buffer> = new Map();

  private nextMessageId = 1;
  private closed = false;

  constructor(connection: Connection, channelId: number, role?: string) {
    this.connection = connection;
    this.channelId = channelId;
    this.role = role;
  }

  get name(): string {
    return this.role
      ? `${this.role} (channel ${this.channelId})`
      : `channel ${this.channelId}`;
  }

  // -------------------------------------------------------------------------
  // Close
  // -------------------------------------------------------------------------

  /**
   * Close this channel and notify the peer.
   * Idempotent — safe to call multiple times.
   */
  close(): void {
    if (this.closed || this.connection.channels.get(this.channelId) !== this) {
      this.closed = true;
      return;
    }
    this.closed = true;
    if (this.connection.live) {
      void this.connection.sendPacket({
        payload: CLOSE_CHANNEL_PAYLOAD,
        messageId: CLOSE_CHANNEL_MESSAGE_ID,
        channelId: this.channelId,
        isReply: false,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Raw send/receive
  // -------------------------------------------------------------------------

  /**
   * Send a raw bytes request on this channel.
   * @returns The message ID assigned to the request.
   */
  async sendRequestRaw(message: Buffer): Promise<number> {
    const msgId = this.nextMessageId++;
    await this.connection.sendPacket({
      payload: message,
      channelId: this.channelId,
      isReply: false,
      messageId: msgId,
    });
    return msgId;
  }

  /**
   * Send a CBOR-encoded request.
   * @returns The message ID assigned to the request.
   */
  async sendRequest(message: Record<string, unknown>): Promise<number> {
    return this.sendRequestRaw(Buffer.from(cborEncode(message)));
  }

  /**
   * Create and send a CBOR request, returning a {@link PendingRequest}.
   */
  request(message: Record<string, unknown>): PendingRequest {
    const msgId = this.nextMessageId++;
    void this.connection.sendPacket({
      payload: Buffer.from(cborEncode(message)),
      channelId: this.channelId,
      isReply: false,
      messageId: msgId,
    });
    return new PendingRequest(this, msgId);
  }

  /**
   * Wait for and return the raw bytes response for `messageId`.
   */
  async receiveResponseRaw(
    messageId: number,
    options: ReceiveOptions = {},
  ): Promise<Buffer> {
    while (!this.responses.has(messageId)) {
      await this._processOneMessage(options.timeout ?? CHANNEL_TIMEOUT);
    }
    const result = this.responses.get(messageId)!;
    this.responses.delete(messageId);
    return result;
  }

  /**
   * Wait for and return the decoded CBOR response for `messageId`.
   */
  async receiveResponse(
    messageId: number,
    options: ReceiveOptions = {},
  ): Promise<unknown> {
    const raw = await this.receiveResponseRaw(messageId, options);
    return resultOrError(cborDecode(raw) as Record<string, unknown>);
  }

  /**
   * Receive the next raw incoming request from the peer.
   * @returns `[messageId, payloadBytes]`
   */
  async receiveRequestRaw(
    options: ReceiveOptions = {},
  ): Promise<[number, Buffer]> {
    while (this.requests.length === 0) {
      await this._processOneMessage(options.timeout ?? CHANNEL_TIMEOUT);
    }
    const pkt = this.requests.shift()!;
    return [pkt.messageId, pkt.payload];
  }

  /**
   * Receive the next CBOR-decoded incoming request from the peer.
   * @returns `[messageId, decodedPayload]`
   */
  async receiveRequest(
    options: ReceiveOptions = {},
  ): Promise<[number, unknown]> {
    const [msgId, raw] = await this.receiveRequestRaw(options);
    return [msgId, cborDecode(raw)];
  }

  /**
   * Send a raw bytes reply for a previously received request.
   */
  async sendResponseRaw(messageId: number, message: Buffer): Promise<void> {
    await this.connection.sendPacket({
      payload: message,
      channelId: this.channelId,
      isReply: true,
      messageId,
    });
  }

  /**
   * Send a CBOR-encoded `{result: value}` reply.
   */
  async sendResponseValue(messageId: number, value: unknown): Promise<void> {
    await this.sendResponseRaw(
      messageId,
      Buffer.from(cborEncode({ result: value })),
    );
  }

  /**
   * Send an error reply for a previously received request.
   *
   * Pass either an `Error` object as the second argument, or provide
   * `error` and `errorType` in the options for a custom error.
   */
  async sendResponseError(
    messageId: number,
    err?: Error,
    options: { error?: string; errorType?: string } = {},
  ): Promise<void> {
    const errorMsg = options.error ?? err?.message ?? String(err);
    const errorType =
      options.errorType ?? (err ? err.constructor.name : "Error");
    const response: Record<string, unknown> = {
      error: errorMsg,
      type: errorType,
    };
    if (err !== undefined) {
      response["detail"] = err.stack ?? String(err);
    }
    await this.sendResponseRaw(messageId, Buffer.from(cborEncode(response)));
  }

  /**
   * Process incoming requests with `handler` until `until()` returns true.
   *
   * Sends a success response (`{result: ...}`) or an error response if
   * `handler` throws.
   */
  async handleRequests(
    handler: (msg: unknown) => Promise<unknown> | unknown,
    options: { until?: () => boolean } = {},
  ): Promise<void> {
    const until = options.until ?? (() => false);
    while (!until()) {
      const [msgId, msg] = await this.receiveRequest();
      try {
        const result = await handler(msg);
        await this.sendResponseValue(msgId, result);
      } catch (e) {
        await this.sendResponseError(
          msgId,
          e instanceof Error ? e : new Error(String(e)),
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /**
   * Run the connection reader until this channel has a message in its inbox,
   * then process exactly one packet from the inbox.
   */
  private async _processOneMessage(timeout: number): Promise<void> {
    const start = Date.now();
    await this.connection.runReader(
      () =>
        this.closed ||
        (Date.now() - start) / 1000 > timeout ||
        !this._needsMessages(),
    );

    if (this.closed) {
      throw new Error(`${this.name} is closed`);
    }

    if (this.inbox.length === 0) {
      throw new TimeoutError(
        `Timed out after ${timeout}s waiting for a message on ${this.name}`,
      );
    }

    const item = this.inbox.shift()!;

    if (item === SHUTDOWN) {
      throw new Error("Connection closed");
    }

    const packet = item as Packet;
    if (packet.isReply) {
      if (this.responses.has(packet.messageId)) {
        throw new Error(`Got two responses for message ID ${packet.messageId}`);
      }
      this.responses.set(packet.messageId, packet.payload);
    } else {
      this.requests.push(packet);
    }
  }

  private _needsMessages(): boolean {
    return !this.closed && this.inbox.length === 0;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read a single packet with a timeout.
 * Throws {@link TimeoutError} if no packet arrives within `timeoutMs`.
 */
function readPacketWithTimeout(
  socket: net.Socket,
  timeoutMs: number,
): Promise<Packet> {
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    setTimeout(() => {
      reject(new TimeoutError(`Read timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([readPacket(socket), timeoutPromise]);
}
