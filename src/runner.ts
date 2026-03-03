/**
 * Test runner for the Hegel SDK.
 *
 * Implements the {@link Client} class which manages the test protocol with a
 * Hegel server, and `AsyncLocalStorage`-based context state for generator
 * functions that must be callable without an explicit channel parameter.
 *
 * @packageDocumentation
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { Channel, Connection, RequestError } from "./connection.js";
import { encodeValue } from "./protocol.js";
import type { Generator } from "./generators.js";

// ---------------------------------------------------------------------------
// Supported protocol version range
// ---------------------------------------------------------------------------

const SUPPORTED_PROTOCOL_LO = 0.1;
const SUPPORTED_PROTOCOL_HI = 0.3;

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Raised by {@link assume} when the condition is false.
 * Signals that this test case should be marked `INVALID`.
 */
export class AssumeRejected extends Error {
  constructor() {
    super("assume() condition was false");
    this.name = "AssumeRejected";
  }
}

/**
 * Raised when the server sends a StopTest error response.
 * Signals that the test data is exhausted; the test runner catches this
 * and skips `mark_complete` (the server has already closed the test case).
 */
export class DataExhausted extends Error {
  constructor(message = "Server ran out of test data") {
    super(message);
    this.name = "DataExhausted";
  }
}

// ---------------------------------------------------------------------------
// Span label constants
// ---------------------------------------------------------------------------

/**
 * Label constants for generation spans.
 * Must match the values expected by the hegel server exactly.
 */
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
  ENUM_VARIANT: 15,
} as const;

// ---------------------------------------------------------------------------
// AsyncLocalStorage context
// ---------------------------------------------------------------------------

/**
 * Per-test-case context stored in AsyncLocalStorage.
 * Holds the current data channel and flags for the active test case.
 */
export interface TestCaseData {
  /** The data channel for the current test case. */
  channel: Channel;
  /** Whether this is the final (shrunk) replay of a failing test. */
  isFinal: boolean;
  /**
   * Whether the server has sent StopTest (DataExhausted).
   * When true, no further commands should be sent on the channel.
   */
  testAborted: boolean;
}

/**
 * AsyncLocalStorage for the current test context.
 * `getStore()` returns `undefined` outside a session call stack,
 * `null` when explicitly cleared, or a `TestCaseData` inside `_runTestCase`.
 */
export const _testContextStorage = new AsyncLocalStorage<TestCaseData | null>();

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Client for the Hegel test server protocol.
 *
 * Performs the handshake and drives the test loop: receiving `test_case` and
 * `test_done` events, dispatching to `_runTestCase`, and collecting results.
 *
 * Use the static {@link Client.create} factory to construct a Client after
 * completing the protocol handshake.
 */
export class Client {
  /** The underlying connection. */
  readonly connection: Connection;

  private readonly _control: Channel;

  /**
   * Construct a Client over an already-connected (but NOT yet handshaked)
   * Connection. Prefer {@link Client.create} which performs the handshake.
   */
  constructor(connection: Connection) {
    this.connection = connection;
    this._control = connection.controlChannel;
  }

  /**
   * Factory: performs the protocol handshake and returns a ready Client.
   *
   * @throws {ConnectionError} If the server's protocol version is unsupported.
   */
  static async create(connection: Connection): Promise<Client> {
    const versionStr = await connection.sendHandshake();
    const version = parseFloat(versionStr);
    if (version < SUPPORTED_PROTOCOL_LO || version > SUPPORTED_PROTOCOL_HI) {
      throw new ConnectionError(
        `hegel-typescript supports protocol versions ${SUPPORTED_PROTOCOL_LO} through ` +
          `${SUPPORTED_PROTOCOL_HI}, but got server version ${version}.`,
      );
    }
    return new Client(connection);
  }

  /**
   * Run a property test.
   *
   * Sends the `run_test` command, drives the test loop, and raises on failure.
   * Re-raises the original exception for a single failure, or raises
   * `AggregateError` for multiple distinct failures.
   *
   * @param name - Test name shown in failure reports.
   * @param testFn - The test body (may be async).
   * @param opts - Options: `testCases` (default 100).
   */
  async runTest(
    name: string,
    testFn: () => void | Promise<void>,
    opts: { testCases?: number } = {},
  ): Promise<void> {
    const testCases = opts.testCases ?? 100;
    const testChannel = this.connection.newChannel({ role: "Test" });

    await this._control
      .request({
        command: "run_test",
        name,
        test_cases: testCases,
        channel_id: testChannel.channelId,
      })
      .get();

    let resultData: Record<string, unknown> | undefined;

    // Main test loop: handle test_case and test_done events
    while (true) {
      const [messageId, rawMessage] = await testChannel.receiveRequest();
      const message = rawMessage as Record<string, unknown>;
      const event = message["event"] as string | undefined;

      if (event === "test_case") {
        const channelId = message["channel_id"] as number;
        await testChannel.sendResponseValue(messageId, null);
        const testCaseChannel = this.connection.connectChannel(channelId, {
          role: "Test Case",
        });
        await this._runTestCase(testCaseChannel, testFn, false);
      } else if (event === "test_done") {
        await testChannel.sendResponseValue(messageId, true);
        resultData = message["results"] as Record<string, unknown>;
        break;
      } else {
        // Unrecognised event — send error response
        await testChannel.sendResponseRaw(
          messageId,
          encodeValue({
            error: `Unrecognised event ${String(event)}`,
            type: "InvalidMessage",
          }),
        );
      }
    }

    const nInteresting = resultData!["interesting_test_cases"] as number;
    if (nInteresting === 0) return;

    // Re-run the minimal failing test cases (final/shrunk replays)
    const exceptions: Error[] = [];
    for (let i = 0; i < nInteresting; i++) {
      try {
        const [messageId, rawMessage] = await testChannel.receiveRequest();
        const message = rawMessage as Record<string, unknown>;
        const channelId = message["channel_id"] as number;
        await testChannel.sendResponseValue(messageId, null);
        const testCaseChannel = this.connection.connectChannel(channelId, {
          role: "Test Case",
        });
        await this._runTestCase(testCaseChannel, testFn, true);
        // Final test case passed when it should have failed
        if (nInteresting > 1) {
          throw new AssertionError(`Expected test case ${i} to fail but it didn't`);
        } else {
          throw new AssertionError("Expected test case to fail but it didn't");
        }
      } catch (e) {
        if (nInteresting === 1) throw e;
        exceptions.push(e instanceof Error ? e : new Error(String(e)));
      }
    }
    throw new AggregateError(exceptions, "multiple failures");
  }

  /**
   * Run a single test case inside an AsyncLocalStorage context.
   *
   * Sets up context variables, calls the test body, handles exceptions,
   * and sends `mark_complete` before closing the channel.
   *
   * @param channel - The data channel for this test case.
   * @param testFn - The test body.
   * @param isFinal - Whether this is the final (shrunk) replay.
   */
  async _runTestCase(
    channel: Channel,
    testFn: () => void | Promise<void>,
    isFinal: boolean,
  ): Promise<void> {
    // Nesting check: context must be null/undefined (not already inside a test)
    const existing = _testContextStorage.getStore();
    if (existing !== undefined && existing !== null) {
      throw new RuntimeError("Cannot nest test cases - already inside a test case");
    }

    const data: TestCaseData = { channel, isFinal, testAborted: false };

    await _testContextStorage.run(data, async () => {
      let alreadyComplete = false;
      let status = "VALID";
      let origin: string | null = null;

      try {
        await testFn();
      } catch (e) {
        if (e instanceof AssumeRejected) {
          status = "INVALID";
        } else if (e instanceof DataExhausted) {
          alreadyComplete = true;
        } else if (e instanceof ConnectionError) {
          throw e;
        } else {
          status = "INTERESTING";
          const err = e instanceof Error ? e : new Error(String(e));
          origin = extractOrigin(err);
          if (isFinal) throw e;
        }
      } finally {
        if (!alreadyComplete) {
          // Fire-and-forget: send mark_complete then close
          channel
            .sendRequest({
              command: "mark_complete",
              status,
              origin,
            })
            .catch(() => {});
        }
        channel.close();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Context helpers (used by generator functions)
// ---------------------------------------------------------------------------

/**
 * Get the current test channel.
 *
 * @throws {RuntimeError} If called outside a test function.
 */
export function _getChannel(): Channel {
  const data = _testContextStorage.getStore();
  if (!data) {
    throw new RuntimeError("Not in a test context - must be called from within a test function");
  }
  return data.channel;
}

// ---------------------------------------------------------------------------
// Generator/test-body helper functions
// ---------------------------------------------------------------------------

/**
 * Generate a value from a raw schema dict.
 *
 * Sends `{"command": "generate", "schema": schema}` to the server and returns
 * the result. If the server responds with StopTest, sets the `testAborted` flag
 * and throws {@link DataExhausted} to unwind the test body.
 *
 * @param schema - The schema to generate from.
 * @returns The generated value.
 * @throws {DataExhausted} If the server sends StopTest.
 * @throws {RequestError} For any other server error.
 */
export async function generateFromSchema(
  schema: Record<string, unknown>,
  data: TestCaseData,
): Promise<unknown> {
  const channel = data.channel;
  try {
    return await channel.request({ command: "generate", schema }).get();
  } catch (e) {
    if (e instanceof RequestError && e.errorType === "StopTest") {
      data.testAborted = true;
      throw new DataExhausted("Server ran out of data");
    }
    throw e;
  }
}

/**
 * Reject the current test case if `condition` is false.
 *
 * @throws {AssumeRejected} When condition is false.
 */
export function assume(condition: boolean): void {
  const data = _testContextStorage.getStore();
  if (!data) {
    throw new RuntimeError("assume() cannot be called outside of a Hegel test");
  }
  if (!condition) {
    throw new AssumeRejected();
  }
}

/**
 * Record a note that is printed on the final (failing) test run.
 *
 * On non-final runs this is a no-op.
 *
 * @param message - The message to print.
 */
export function note(message: string): void {
  const data = _testContextStorage.getStore();
  if (!data) {
    throw new RuntimeError("note() cannot be called outside of a Hegel test");
  }
  if (data.isFinal) {
    process.stderr.write(message + "\n");
  }
}

/**
 * Guide the search toward higher target values.
 *
 * @param value - The target score to maximize.
 * @param label - Optional label for this target.
 */
export async function target(value: number, label = ""): Promise<void> {
  const data = _testContextStorage.getStore();
  if (!data) {
    throw new RuntimeError("target() cannot be called outside of a Hegel test");
  }
  const channel = data.channel;
  await channel.request({ command: "target", value, label }).get();
}

/**
 * Start a generation span for better shrinking.
 *
 * No-op when the test has been aborted (StopTest received).
 *
 * @param label - Span label constant (see `Labels`).
 */
export async function startSpan(label: number, data: TestCaseData): Promise<void> {
  if (data.testAborted) return;
  const channel = data.channel;
  await channel.request({ command: "start_span", label }).get();
}

/**
 * End the current generation span.
 *
 * No-op when the test has been aborted (StopTest received).
 *
 * @param opts.discard - If true, the span is discarded (not counted toward coverage).
 */
export async function stopSpan(opts: { discard?: boolean }, data: TestCaseData): Promise<void> {
  if (data.testAborted) return;
  const channel = data.channel;
  await channel.request({ command: "stop_span", discard: opts.discard ?? false }).get();
}

// ---------------------------------------------------------------------------
// draw — primary API for generating values
// ---------------------------------------------------------------------------

/**
 * Draw a value from a generator.
 *
 * This is the primary way to get values from generators inside a Hegel test.
 * It retrieves the current test context and delegates to the generator's
 * `doDraw` method.
 *
 * @param gen - The generator to draw from.
 * @throws {RuntimeError} If called outside a Hegel test.
 */
export async function draw<T>(gen: Generator<T>): Promise<T> {
  const data = _testContextStorage.getStore();
  if (!data) {
    throw new RuntimeError("draw() cannot be called outside of a Hegel test");
  }
  return gen.doDraw(data);
}

// ---------------------------------------------------------------------------
// Origin extraction
// ---------------------------------------------------------------------------

/**
 * Extract origin information from an Error for reporting to the server.
 *
 * Returns a string of the form `"ErrorType at filename:lineno"`.
 * Falls back to `"ErrorType at :0"` when no stack trace is available.
 *
 * @param err - The error to extract origin from.
 */
export function extractOrigin(err: Error): string {
  const errName = err.constructor?.name ?? "Error";
  const stack = err.stack;
  if (!stack) {
    return `${errName} at :0`;
  }

  // Parse all "at ..." frames from the stack trace.
  // Prefer the first frame that isn't inside node_modules (user code).
  // Fall back to the last parseable frame if all frames are internal.
  const lines = stack.split("\n");
  let firstUserFile = "";
  let firstUserLine = "0";
  let lastFile = "";
  let lastLine = "0";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) continue;
    // Format: "at FunctionName (file:line:col)" or "at file:line:col"
    let file = "";
    let lineNum = "";
    const parenMatch = trimmed.match(/\((.+):(\d+):\d+\)$/);
    if (parenMatch) {
      file = parenMatch[1]!;
      lineNum = parenMatch[2]!;
    } else {
      const plainMatch = trimmed.match(/at (.+):(\d+):\d+$/);
      if (plainMatch) {
        file = plainMatch[1]!;
        lineNum = plainMatch[2]!;
      }
    }
    if (!file) continue;
    lastFile = file;
    lastLine = lineNum;
    if (!firstUserFile && !file.includes("node_modules")) {
      firstUserFile = file;
      firstUserLine = lineNum;
    }
  }

  const chosenFile = firstUserFile || lastFile;
  const chosenLine = firstUserFile ? firstUserLine : lastLine;
  if (!chosenFile) {
    return `${errName} at :0`;
  }
  return `${errName} at ${chosenFile}:${chosenLine}`;
}

// ---------------------------------------------------------------------------
// RuntimeError — used for nesting / context errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the SDK is called outside its expected context.
 * (e.g., nesting test cases, calling generator functions outside a test)
 */
export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

// ---------------------------------------------------------------------------
// ConnectionError — re-exported for convenience
// ---------------------------------------------------------------------------

/**
 * Thrown when the connection to the hegel server is lost.
 */
export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

// ---------------------------------------------------------------------------
// AssertionError — for test runner internal assertions
// ---------------------------------------------------------------------------

/**
 * Thrown when a final test case passes when it should have failed.
 */
export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}
