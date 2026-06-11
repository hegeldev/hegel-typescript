/**
 * Test runner: Hegel builder, Settings, and test lifecycle.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { HegelSession } from "./session.js";
import {
  TestCase,
  StopTestError,
  FlakyAbortError,
  AssumeError,
  type DataSource,
} from "./testCase.js";
import { encode, decode } from "cbor-x";
import type { Connection, Stream } from "./connection.js";

export enum Verbosity {
  Quiet = "quiet",
  Normal = "normal",
  Verbose = "verbose",
  Debug = "debug",
}

export enum HealthCheck {
  FilterTooMuch = "filter_too_much",
  TooSlow = "too_slow",
  TestCasesTooLarge = "test_cases_too_large",
  LargeInitialTestCase = "large_initial_test_case",
}

export type Database = { kind: "unset" } | { kind: "disabled" } | { kind: "path"; path: string };

export const Database = {
  unset: { kind: "unset" } as Database,
  disabled: { kind: "disabled" } as Database,
  fromPath: (path: string): Database => ({ kind: "path", path }),
};

export interface Settings {
  testCases: number;
  seed: number | null;
  verbosity: Verbosity;
  derandomize: boolean;
  database: Database;
  suppressHealthCheck: HealthCheck[];
}

function isInCI(): boolean {
  const ciVars: Array<[string, string | null]> = [
    ["CI", null],
    ["BITBUCKET_COMMIT", null],
    ["BUILDKITE", "true"],
    ["CIRCLECI", "true"],
    ["CIRRUS_CI", "true"],
    ["CODEBUILD_BUILD_ID", null],
    ["GITHUB_ACTIONS", "true"],
    ["GITLAB_CI", null],
    ["HEROKU_TEST_RUN_ID", null],
    ["TEAMCITY_VERSION", null],
    ["TF_BUILD", "true"],
    ["bamboo.buildKey", null],
  ];
  return ciVars.some(([key, value]) => {
    if (value === null) {
      return process.env[key] !== undefined;
    }
    return process.env[key] === value;
  });
}

export function defaultSettings(): Settings {
  const inCI = isInCI();
  return {
    testCases: 100,
    seed: null,
    verbosity: Verbosity.Normal,
    derandomize: inCI,
    database: inCI ? Database.disabled : Database.unset,
    suppressHealthCheck: [],
  };
}

// ---------------------------------------------------------------------------
// ServerDataSource
// ---------------------------------------------------------------------------

/**
 * DataSource implementation that communicates with the hegel server
 * over a multiplexed stream connection.
 */
export class ServerDataSource implements DataSource {
  private stream: Stream;
  private connection: Connection;
  private _aborted = false;

  constructor(connection: Connection, stream: Stream) {
    this.connection = connection;
    this.stream = stream;
  }

  private sendRequest(command: string, payload: Record<string, unknown> = {}): unknown {
    /* v8 ignore start: reachable via stopSpan after abort, but swallowed by catch */
    if (this._aborted) {
      throw new StopTestError();
    }
    /* v8 ignore stop */

    const message: Record<string, unknown> = { command, ...payload };
    const encoded = encode(message);
    const id = this.stream.sendRequest(encoded);
    const responseBytes = this.stream.receiveReply(id);
    const response = decode(responseBytes) as Record<string, unknown>;

    if ("error" in response) {
      const errorType = response["type"] as string;
      const errorMsg = JSON.stringify(response["error"]);

      if (
        errorMsg.includes("overflow") ||
        errorMsg.includes("StopTest") ||
        errorType.includes("overflow") ||
        errorType.includes("StopTest")
      ) {
        this.stream.markClosed();
        this._aborted = true;
        throw new StopTestError();
      }
      /* v8 ignore start: flaky during generate is rare; test_done path covered by integration tests */
      if (errorMsg.includes("FlakyStrategyDefinition") || errorMsg.includes("FlakyReplay")) {
        this.stream.markClosed();
        this._aborted = true;
        throw new FlakyAbortError();
      }
      /* v8 ignore stop */
      /* v8 ignore start: requires server to crash mid-request */
      if (this.connection.hasServerExited()) {
        throw new Error(`Server process crashed`);
      }
      /* v8 ignore stop */
      throw new Error(`Server error (${errorType}): ${errorMsg}`);
    }

    return response["result"];
  }

  generate(schema: Record<string, unknown>): unknown {
    return this.sendRequest("generate", { schema });
  }

  startSpan(label: number): void {
    this.sendRequest("start_span", { label });
  }

  stopSpan(discard: boolean): void {
    this.sendRequest("stop_span", { discard });
  }

  newCollection(minSize: number, maxSize?: number): number {
    const payload: Record<string, unknown> = { min_size: minSize };
    if (maxSize !== undefined) {
      payload["max_size"] = maxSize;
    }
    return this.sendRequest("new_collection", payload) as number;
  }

  collectionMore(collectionId: number): boolean {
    return this.sendRequest("collection_more", {
      collection_id: collectionId,
    }) as boolean;
  }

  collectionReject(collectionId: number, why?: string): void {
    const payload: Record<string, unknown> = {
      collection_id: collectionId,
    };
    /* v8 ignore start: callers always provide why */
    if (why !== undefined) {
      payload["why"] = why;
    }
    /* v8 ignore stop */
    this.sendRequest("collection_reject", payload);
  }

  markComplete(status: string, origin: string | null): void {
    try {
      // Send mark_complete without waiting for the reply. We never used the
      // reply payload (the old code called receiveReply and discarded it), and
      // the protocol does not require the client to block here before reading
      // test_done on the main test stream. Blocking does deadlock when the
      // server reports flaky in test_done before answering this request
      // (issue #48). hegel-go can wait in doRequest because a background read
      // loop keeps draining the pipe; our synchronous reader cannot. The stream
      // is closed unconditionally in finalizeTestCase afterward.
      const encoded = encode({
        command: "mark_complete",
        status,
        origin: origin ?? null,
      });
      this.stream.sendRequest(encoded);
    } catch {
      // ignore errors during mark_complete
    }
  }

  closeTestCase(): void {
    this.stream.close();
  }

  testAborted(): boolean {
    return this._aborted;
  }
}

export type TestCaseResult =
  | { status: "valid" }
  | { status: "invalid" }
  | { status: "interesting"; error: unknown };

function extractOrigin(error: unknown): string {
  if (!(error instanceof Error) || !error.stack) return "<unknown>";
  const lines = error.stack.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("at ") && !trimmed.includes("node_modules")) {
      return trimmed;
    }
  }
  /* v8 ignore start: all stack traces in practice have at least one non-node_modules frame */
  return "<unknown>";
  /* v8 ignore stop */
}

function classifyResult(
  e: unknown,
  isFinal: boolean,
): { result: TestCaseResult; origin: string | null } {
  if (e instanceof AssumeError) return { result: { status: "invalid" }, origin: null };
  if (e instanceof StopTestError) return { result: { status: "invalid" }, origin: null };
  if (e instanceof FlakyAbortError) return { result: { status: "invalid" }, origin: null };

  if (isFinal) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n${msg}`);
    if (e instanceof Error && e.stack) {
      console.error(e.stack);
    }
  }
  return { result: { status: "interesting", error: e }, origin: extractOrigin(e) };
}

function finalizeTestCase(
  tc: TestCase,
  dataSource: DataSource,
  result: TestCaseResult,
  origin: string | null,
): void {
  try {
    if (!tc.testAborted) {
      const status =
        result.status === "valid"
          ? "VALID"
          : result.status === "invalid"
            ? "INVALID"
            : "INTERESTING";
      dataSource.markComplete(status, origin);
    }
  } finally {
    dataSource.closeTestCase();
  }
}

export async function runTestCaseAsync(
  dataSource: DataSource,
  testFn: (tc: TestCase) => void | Promise<void>,
  isFinal: boolean,
): Promise<TestCaseResult> {
  const tc = new TestCase(dataSource, isFinal);

  let result: TestCaseResult;
  let origin: string | null = null;

  try {
    await testFn(tc);
    result = { status: "valid" };
  } catch (e: unknown) {
    ({ result, origin } = classifyResult(e, isFinal));
  }

  finalizeTestCase(tc, dataSource, result, origin);
  return result;
}

export function runTestCase(
  dataSource: DataSource,
  testFn: (tc: TestCase) => void,
  isFinal: boolean,
): TestCaseResult {
  const tc = new TestCase(dataSource, isFinal);

  let result: TestCaseResult;
  let origin: string | null = null;

  try {
    testFn(tc);
    result = { status: "valid" };
  } catch (e: unknown) {
    ({ result, origin } = classifyResult(e, isFinal));
  }

  finalizeTestCase(tc, dataSource, result, origin);
  return result;
}

export interface TestLocation {
  function: string;
  file: string;
  class: string;
  beginLine: number;
}

/* v8 ignore start: only runs inside Antithesis */
function isRunningInAntithesis(): boolean {
  const dir = process.env["ANTITHESIS_OUTPUT_DIR"];
  return dir !== undefined && dir !== "";
}
function emitAntithesisAssertion(location: TestLocation, passed: boolean): void {
  const dir = process.env["ANTITHESIS_OUTPUT_DIR"];
  if (!dir) return;

  const filePath = path.join(dir, "sdk.jsonl");
  const id = `${location.class}::${location.function} passes properties`;

  const locationObj = {
    class: location.class,
    function: location.function,
    file: location.file,
    begin_line: location.beginLine,
    begin_column: 0,
  };

  const declaration = {
    antithesis_assert: {
      hit: false,
      must_hit: true,
      assert_type: "always",
      display_type: "Always",
      condition: false,
      id,
      message: id,
      location: locationObj,
    },
  };

  const evaluation = {
    antithesis_assert: {
      hit: true,
      must_hit: true,
      assert_type: "always",
      display_type: "Always",
      condition: passed,
      id,
      message: id,
      location: locationObj,
    },
  };

  fs.appendFileSync(
    filePath,
    JSON.stringify(declaration) + "\n" + JSON.stringify(evaluation) + "\n",
  );
  /* v8 ignore stop */
}

export class Hegel {
  private testFn: (tc: TestCase) => void | Promise<void>;
  private _settings: Settings;
  private _testLocation: TestLocation | null = null;

  constructor(testFn: (tc: TestCase) => void | Promise<void>) {
    this.testFn = testFn;
    this._settings = defaultSettings();
  }

  /** Override default settings. Returns this for chaining. */
  settings(s: Partial<Settings>): this {
    Object.assign(this._settings, s);
    return this;
  }

  /** Set the test location for Antithesis integration. */
  /* v8 ignore start: only used inside Antithesis */
  testLocation(location: TestLocation): this {
    this._testLocation = location;
    return this;
  }
  /* v8 ignore stop */

  /**
   * Generator that drives the wire protocol but yields a `ServerDataSource`
   * (plus an `isFinal` flag) each time a test case needs to be executed.
   * The driver ({@link run} or {@link runSync}) calls the user's test body
   * and resumes the generator with the resulting {@link TestCaseResult}.
   * This factoring lets the sync and async drivers share one implementation
   * of the protocol loop.
   */
  private *runSteps(): Generator<{ ds: ServerDataSource; isFinal: boolean }, void, TestCaseResult> {
    const session = HegelSession.get();
    const connection = session.connection;
    const testStream = connection.newStream();

    // Build run_test message
    const suppressNames = this._settings.suppressHealthCheck.map((c) => c as string);

    const runTestMsg: Record<string, unknown> = {
      command: "run_test",
      test_cases: this._settings.testCases,
      seed: this._settings.seed,
      stream_id: testStream.streamId,
      derandomize: this._settings.derandomize,
      database_key: Buffer.from(this.testFn.toString()),
    };

    if (this._settings.database.kind === "disabled") {
      runTestMsg["database"] = null;
    } else if (this._settings.database.kind === "path") {
      runTestMsg["database"] = this._settings.database.path;
    }

    if (suppressNames.length > 0) {
      runTestMsg["suppress_health_check"] = suppressNames;
    }

    // Send run_test on control stream
    const controlPayload = encode(runTestMsg);
    const reqId = session.controlStream.sendRequest(controlPayload);
    session.controlStream.receiveReply(reqId);

    // Event loop
    let resultData: Record<string, unknown>;
    const ackNull = encode({ result: null });

    while (true) {
      const [eventId, eventPayload] = testStream.receiveRequest();
      const event = decode(eventPayload) as Record<string, unknown>;
      const eventType = event["event"] as string;

      if (eventType === "test_case") {
        const streamId = event["stream_id"] as number;
        const testCaseStream = connection.connectStream(streamId);

        // Ack BEFORE running the test
        testStream.writeReply(eventId, ackNull);

        const ds = new ServerDataSource(connection, testCaseStream);
        yield { ds, isFinal: false };
      } else {
        /* v8 ignore start: server only sends test_case and test_done events */
        if (eventType !== "test_done") {
          throw new Error(`Unknown event: ${eventType}`);
        }
        /* v8 ignore stop */
        const ackTrue = encode({ result: true });
        testStream.writeReply(eventId, ackTrue);
        resultData = event["results"] as Record<string, unknown>;
        break;
      }
    }

    // Check for server-side errors. Close the test stream before throwing so
    // the server is not left waiting for acks on a follow-up test_case (which
    // would wedge the shared session for the next hegel.test() call).
    /* v8 ignore start: requires server to report error in test_done results */
    if (resultData["error"]) {
      testStream.close();
      throw new Error(`Server error: ${resultData["error"]}`);
    }
    /* v8 ignore stop */
    if (resultData["health_check_failure"]) {
      testStream.close();
      throw new Error(`Health check failure:\n${resultData["health_check_failure"]}`);
    }
    if (resultData["flaky"]) {
      testStream.close();
      throw new Error(`Flaky test detected: ${resultData["flaky"]}`);
    }

    const nInteresting = resultData["interesting_test_cases"] as number;

    // Final replays for interesting test cases
    let finalResult: TestCaseResult | null = null;

    for (let i = 0; i < nInteresting; i++) {
      const [eventId, eventPayload] = testStream.receiveRequest();
      const event = decode(eventPayload) as Record<string, unknown>;
      const streamId = event["stream_id"] as number;
      const testCaseStream = connection.connectStream(streamId);

      testStream.writeReply(eventId, ackNull);

      const ds = new ServerDataSource(connection, testCaseStream);
      const result = yield { ds, isFinal: true };

      /* v8 ignore start: replay cases are always interesting */
      if (result.status === "interesting") {
        finalResult = result;
      }
      /* v8 ignore stop */
    }

    testStream.close();

    const passed = resultData["passed"] as boolean;
    const testFailed = !passed;

    /* v8 ignore start: only runs inside Antithesis */
    if (isRunningInAntithesis() && this._testLocation) {
      emitAntithesisAssertion(this._testLocation, !testFailed);
    }
    /* v8 ignore stop */

    if (testFailed) {
      let msg = "unknown";
      /* v8 ignore start: finalResult is always set when test fails with interesting cases */
      if (finalResult && finalResult.status === "interesting") {
        const err = finalResult.error;
        msg = err instanceof Error ? err.message : String(err);
      }
      /* v8 ignore stop */
      throw new Error(`Property test failed: ${msg}`);
    }
  }

  async run(): Promise<void> {
    const gen = this.runSteps();
    let next = gen.next();
    while (!next.done) {
      const { ds, isFinal } = next.value;
      const result = await runTestCaseAsync(ds, this.testFn, isFinal);
      next = gen.next(result);
    }
  }

  runSync(): void {
    const gen = this.runSteps();
    let next = gen.next();
    while (!next.done) {
      const { ds, isFinal } = next.value;
      const result = runTestCase(ds, this.testFn as (tc: TestCase) => void, isFinal);
      next = gen.next(result);
    }
  }
}

/**
 * Run a property-based test.
 *
 * If your property is async, see {@link testAsync} instead.
 *
 * @example
 * ```ts
 * import { test } from 'vitest';
 * import * as hegel from 'hegel';
 * import * as gs from 'hegel/generators';
 *
 * test('addition is commutative', () =>
 *   hegel.test((tc) => {
 *     const x = tc.draw(gs.integers());
 *     const y = tc.draw(gs.integers());
 *     expect(x + y).toBe(y + x);
 *   }),
 * );
 * ```
 */
export function test(testFn: (tc: TestCase) => void, settings?: Partial<Settings>): void {
  if (testFn.constructor.name === "AsyncFunction") {
    throw new TypeError("hegel.test received an async test body. Use hegel.testAsync instead.");
  }
  const h = new Hegel(testFn);
  if (settings) h.settings(settings);
  h.runSync();
}

/**
 * Run a property-based test with an asynchronous test body.
 *
 * Returns a `Promise<void>` that resolves when the test completes and
 * rejects if any test case fails.
 *
 * @example
 * ```ts
 * import { test } from 'vitest';
 * import * as hegel from 'hegel';
 * import * as gs from 'hegel/generators';
 *
 * test('my async test', () =>
 *   hegel.testAsync(async (tc) => {
 *     const x = tc.draw(gs.integers());
 *     const result = await someAsyncOperation(x);
 *     expect(result).toEqual(expected(x));
 *   }),
 * );
 * ```
 */
export async function testAsync(
  testFn: (tc: TestCase) => void | Promise<void>,
  settings?: Partial<Settings>,
): Promise<void> {
  const h = new Hegel(testFn);
  if (settings) h.settings(settings);
  await h.run();
}
