/**
 * Test runner and lifecycle management for the Hegel SDK.
 *
 * Implements the client-side protocol for running property-based tests
 * against a Hegel server. The `Client` class manages the test lifecycle,
 * and the free functions (`assume`, `note`, `target`, `generateFromSchema`)
 * use async-context state to find the current data channel without requiring
 * the user to pass connections explicitly.
 *
 * @packageDocumentation
 */

import { AsyncLocalStorage } from "async_hooks";
import { encode as cborEncode } from "cbor2";
import { Channel, Connection, RequestError } from "./connection.js";

// ---------------------------------------------------------------------------
// Supported protocol versions
// ---------------------------------------------------------------------------

const SUPPORTED_VERSION_LO = 0.1;
const SUPPORTED_VERSION_HI = 0.1;

// ---------------------------------------------------------------------------
// Async-context state (replaces Python contextvars)
// ---------------------------------------------------------------------------

/** State stored per async context (i.e., per test case execution). */
interface TestContext {
  channel: Channel;
  isFinal: boolean;
  testAborted: boolean;
}

/** AsyncLocalStorage provides per-async-context state (like Python's ContextVar). */
const asyncStorage = new AsyncLocalStorage<TestContext>();

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Raised when `assume(false)` is called — signals an invalid test case.
 * The runner catches this and marks the test case as `INVALID`.
 */
export class AssumeRejected extends Error {
  constructor() {
    super("Assumption rejected");
    this.name = "AssumeRejected";
  }
}

/**
 * Raised when the Hegel server runs out of test data (StopTest).
 * The runner catches this and skips `mark_complete`.
 */
export class DataExhausted extends Error {
  constructor(message = "Server ran out of data") {
    super(message);
    this.name = "DataExhausted";
  }
}

// ---------------------------------------------------------------------------
// Labels constants (for span tracking)
// ---------------------------------------------------------------------------

/** Constants for span labels used in generation tracking. */
export const Labels = {
  LIST: 1,
  LIST_ELEMENT: 2,
  SET: 3,
  SET_ELEMENT: 4,
  MAP: 5,
  MAP_ENTRY: 6,
  TUPLE: 7,
  ONE_OF: 8,
  OPTIONAL: 9,
  FIXED_DICT: 10,
  FLAT_MAP: 11,
  FILTER: 12,
  MAPPED: 13,
  SAMPLED_FROM: 14,
} as const;

// ---------------------------------------------------------------------------
// Client class
// ---------------------------------------------------------------------------

/**
 * Client for connecting to a Hegel server and running property-based tests.
 */
export class Client {
  /** The underlying connection. */
  readonly connection: Connection;
  /** The control channel (channel 0). */
  private readonly _control: Channel;

  /**
   * Create a Client from an existing Connection.
   * Performs the protocol handshake and validates the server version.
   *
   * @param connection - An established Connection (handshake not yet done).
   */
  constructor(connection: Connection) {
    this.connection = connection;
    this._control = connection.controlChannel;
  }

  /**
   * Perform the handshake. Must be called once before `runTest`.
   * Separated from the constructor so it can be awaited.
   */
  async _init(): Promise<void> {
    const versionStr = await this.connection.sendHandshake();
    const serverVersion = parseFloat(versionStr);
    if (
      !(
        serverVersion >= SUPPORTED_VERSION_LO &&
        serverVersion <= SUPPORTED_VERSION_HI
      )
    ) {
      throw new Error(
        `hegel-typescript supports protocol versions ${SUPPORTED_VERSION_LO} ` +
          `through ${SUPPORTED_VERSION_HI}, but got server version ${serverVersion}.`,
      );
    }
  }

  /**
   * Run a property-based test.
   *
   * @param name - Test name (reported to the server).
   * @param testFn - The test body to run for each generated case.
   * @param testCases - How many test cases to run (default 1000).
   */
  async runTest(
    name: string,
    testFn: () => Promise<void> | void,
    testCases = 1000,
  ): Promise<void> {
    const testChannel = this.connection.newChannel({ role: "Test" });

    // Send run_test command on control channel
    await this._control
      .request({
        command: "run_test",
        name,
        test_cases: testCases,
        channel: testChannel.channelId,
      })
      .get();

    // Main loop: receive test_case and test_done events
    const resultData = await this._runTestLoop(testChannel, testFn);
    const nInteresting = resultData["interesting_test_cases"] as number;
    if (nInteresting === 0) return;

    // Replay interesting (failing) test cases
    if (nInteresting === 1) {
      const [messageId, message] = await testChannel.receiveRequest();
      const msg = message as Record<string, unknown>;
      const channelId = msg["channel"] as number;
      await testChannel.sendResponseValue(messageId, null);
      const testCaseChannel = this.connection.connectChannel(channelId, {
        role: "Test Case",
      });
      // This will throw the original assertion error
      await this._runTestCase(testCaseChannel, testFn, true);
      throw new Error("Expected test case to fail but it didn't");
    }

    // Multiple interesting cases — collect all errors
    const exceptions: Error[] = [];
    for (let i = 0; i < nInteresting; i++) {
      try {
        const [messageId, message] = await testChannel.receiveRequest();
        const msg = message as Record<string, unknown>;
        const channelId = msg["channel"] as number;
        await testChannel.sendResponseValue(messageId, null);
        const testCaseChannel = this.connection.connectChannel(channelId, {
          role: "Test Case",
        });
        await this._runTestCase(testCaseChannel, testFn, true);
        exceptions.push(
          new Error(`Expected test case ${i} to fail but it didn't`),
        );
      } catch (e) {
        /* c8 ignore start */
        exceptions.push(e instanceof Error ? e : new Error(String(e)));
        /* c8 ignore stop */
      }
    }
    throw new AggregateError(exceptions, "multiple failures");
  }

  /**
   * Main event loop: process test_case and test_done events until done.
   * Returns the result data from test_done.
   *
   * @internal
   */
  private async _runTestLoop(
    testChannel: Channel,
    testFn: () => Promise<void> | void,
  ): Promise<Record<string, unknown>> {
    while (true) {
      const [messageId, message] = await testChannel.receiveRequest();
      const msg = message as Record<string, unknown>;
      const event = msg["event"] as string;

      if (event === "test_case") {
        const channelId = msg["channel"] as number;
        await testChannel.sendResponseValue(messageId, null);
        const testCaseChannel = this.connection.connectChannel(channelId, {
          role: "Test Case",
        });
        await this._runTestCase(testCaseChannel, testFn, false);
      } else if (event === "test_done") {
        await testChannel.sendResponseValue(messageId, true);
        return msg["results"] as Record<string, unknown>;
      } else {
        await testChannel.sendResponseRaw(
          messageId,
          Buffer.from(
            cborEncode({
              error: `Unrecognised event ${event}`,
              type: "InvalidMessage",
            }),
          ),
        );
      }
    }
  }

  /**
   * Run a single test case on the given channel.
   *
   * @internal
   */
  async _runTestCase(
    channel: Channel,
    testFn: () => Promise<void> | void,
    isFinal: boolean,
  ): Promise<void> {
    // Prevent nested test case execution
    const existing = asyncStorage.getStore();
    if (existing !== undefined) {
      throw new Error("Cannot nest test cases - already inside a test case");
    }

    const ctx: TestContext = {
      channel,
      isFinal,
      testAborted: false,
    };

    let alreadyComplete = false;
    let status: "VALID" | "INVALID" | "INTERESTING" = "VALID";
    let origin: string | null = null;

    try {
      await asyncStorage.run(ctx, async () => {
        try {
          await testFn();
        } catch (e) {
          if (e instanceof AssumeRejected) {
            status = "INVALID";
          } else if (e instanceof DataExhausted) {
            alreadyComplete = true;
          } else if (
            e instanceof Error &&
            e.message.includes("connection") &&
            e.constructor.name === "Error" &&
            isConnectionError(e)
          ) {
            throw e;
          } else if (e instanceof Error) {
            status = "INTERESTING";
            origin = extractOrigin(e);
            if (isFinal) throw e;
          } else {
            // Non-Error throw
            status = "INTERESTING";
            const wrappedErr = new Error(String(e));
            origin = extractOrigin(wrappedErr);
            if (isFinal) throw wrappedErr;
          }
        }
      });
    } finally {
      if (!alreadyComplete) {
        const stopTestReceived = ctx.testAborted;
        if (!stopTestReceived) {
          await channel.sendRequest({
            command: "mark_complete",
            status,
            origin,
          });
        }
      }
      channel.close();
    }
  }
}

/**
 * Check if an error is a ConnectionError (connection-related system error).
 * In Python, `ConnectionError` is a built-in. In TS, we check by name.
 */
function isConnectionError(e: Error): boolean {
  return (
    e.constructor.name === "ConnectionError" ||
    (e instanceof Error &&
      (e.message.startsWith("connect ECONNREFUSED") ||
        e.message.startsWith("connect ENOENT")))
  );
}

// ---------------------------------------------------------------------------
// Origin extraction
// ---------------------------------------------------------------------------

/**
 * Extract a short origin string from an exception for reporting.
 * Format: "ExceptionType at filename:lineno"
 */
export function extractOrigin(e: Error): string {
  const stack = e.stack;
  if (!stack) {
    return `${e.constructor.name} at :0`;
  }
  // Stack lines look like "    at file:///path/to/file.ts:42:10"
  // or "    at Object.<anonymous> (file.ts:42:10)"
  const lines = stack.split("\n");
  // Find the last user-code frame (skip internal Node frames)
  let filename = "";
  let lineno = 0;
  for (let i = lines.length - 1; i >= 1; i--) {
    const line = lines[i].trim();
    // Match "at something (file:line:col)" or "at file:line:col"
    const match =
      line.match(/\(([^)]+):(\d+):\d+\)$/) ||
      line.match(/at\s+([^\s]+):(\d+):\d+$/);
    if (match) {
      filename = match[1];
      lineno = parseInt(match[2], 10);
      break;
    }
  }
  return `${e.constructor.name} at ${filename}:${lineno}`;
}

// ---------------------------------------------------------------------------
// Context-aware free functions
// ---------------------------------------------------------------------------

/**
 * Get the current test channel from async context.
 * Throws if called outside a test function.
 */
export function getChannel(): Channel {
  const ctx = asyncStorage.getStore();
  if (ctx === undefined) {
    throw new Error(
      "Not in a test context - must be called from within a test function",
    );
  }
  return ctx.channel;
}

/**
 * Generate a value from a schema using the Hegel server.
 *
 * @param schema - A generation schema dict.
 * @returns The generated value.
 */
export async function generateFromSchema(
  schema: Record<string, unknown>,
): Promise<unknown> {
  const channel = getChannel();
  const ctx = asyncStorage.getStore()!;
  try {
    return await channel.request({ command: "generate", schema }).get();
  } catch (e) {
    if (e instanceof RequestError && e.errorType === "StopTest") {
      ctx.testAborted = true;
      throw new DataExhausted("Server ran out of data");
    }
    throw e;
  }
}

/**
 * Reject the current test case if `condition` is false.
 * Records the case as `INVALID` and moves to the next one.
 *
 * @param condition - If false, the test case is rejected.
 */
export function assume(condition: boolean): void {
  if (!condition) {
    throw new AssumeRejected();
  }
}

/**
 * Print `message` to stderr, but only during the final (shrunk) replay.
 * During normal exploration this is a no-op.
 *
 * @param message - The message to print.
 */
export function note(message: string): void {
  const ctx = asyncStorage.getStore();
  if (ctx?.isFinal) {
    process.stderr.write(message + "\n");
  }
}

/**
 * Send a numeric target value to guide the Hegel search engine.
 *
 * @param value - The target value (higher is better by default).
 * @param label - Optional label for the target.
 */
export async function target(value: float, label = ""): Promise<void> {
  const channel = getChannel();
  await channel.request({ command: "target", value, label }).get();
}

// Type alias for clarity
type float = number;

/**
 * Notify the server that a new span is starting.
 *
 * @param label - Span label (from {@link Labels}).
 */
export async function startSpan(label = 0): Promise<void> {
  const ctx = asyncStorage.getStore();
  if (ctx?.testAborted) return;
  const channel = getChannel();
  await channel.request({ command: "start_span", label }).get();
}

/**
 * Notify the server that the current span is ending.
 *
 * @param discard - If true, discard the span's generated values.
 */
export async function stopSpan(discard = false): Promise<void> {
  const ctx = asyncStorage.getStore();
  if (ctx?.testAborted) return;
  const channel = getChannel();
  await channel.request({ command: "stop_span", discard }).get();
}

// ---------------------------------------------------------------------------
// Collection helper
// ---------------------------------------------------------------------------

/**
 * Server-managed collection for generating variable-length sequences.
 */
export class Collection {
  private readonly baseName: string | null;
  private serverName: string | null = null;
  private finished = false;
  readonly minSize: number;
  readonly maxSize: number | null;

  constructor(name: string | null, minSize = 0, maxSize: number | null = null) {
    this.baseName = name;
    this.minSize = minSize;
    this.maxSize = maxSize;
  }

  private async _getServerName(): Promise<string> {
    if (this.serverName === null) {
      const channel = getChannel();
      this.serverName = (await channel
        .request({
          command: "new_collection",
          name: this.baseName,
          min_size: this.minSize,
          max_size: this.maxSize,
        })
        .get()) as string;
    }
    return this.serverName;
  }

  /**
   * Ask the server whether more elements should be generated.
   * Returns false when the collection is complete.
   */
  async more(): Promise<boolean> {
    if (this.finished) return false;
    const name = await this._getServerName();
    const result = await getChannel()
      .request({ command: "collection_more", collection: name })
      .get();
    if (!result) {
      this.finished = true;
    }
    return result as boolean;
  }

  /**
   * Reject the collection (mark as failed constraint).
   */
  async reject(why: string | null = null): Promise<void> {
    if (this.finished) return;
    const name = await this._getServerName();
    await getChannel()
      .request({
        command: "collection_reject",
        collection: name,
        why,
      })
      .get();
  }
}
