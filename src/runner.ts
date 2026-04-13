/**
 * Test runner: Hegel builder, Settings, and test lifecycle.
 *
 * @packageDocumentation
 */

import { HegelSession } from "./session.js";
import { TestCase, StopTestError, AssumeError } from "./testCase.js";
import { encodeValue, decodeValue } from "./protocol.js";
import type { Connection, Stream } from "./connection.js";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface Settings {
  testCases: number;
  seed: number | null;
  verbosity: Verbosity;
  derandomize: boolean;
  database: "unset" | "disabled" | string;
  suppressHealthCheck: HealthCheck[];
}

function isInCI(): boolean {
  const ciVars: Array<[string, string | null]> = [
    ["CI", null],
    ["BITBUCKET_COMMIT", null],
    ["CIRCLECI", "true"],
    ["CIRRUS_CI", "true"],
    ["CODEBUILD_BUILD_ID", null],
    ["GITHUB_ACTIONS", "true"],
    ["GITLAB_CI", null],
    ["HEROKU_TEST_RUN_ID", null],
    ["TEAMCITY_VERSION", null],
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
    database: inCI ? "disabled" : "unset",
    suppressHealthCheck: [],
  };
}

// ---------------------------------------------------------------------------
// Test case result
// ---------------------------------------------------------------------------

type TestCaseResult =
  | { status: "valid" }
  | { status: "invalid" }
  | { status: "interesting"; error: unknown };

// ---------------------------------------------------------------------------
// Hegel builder
// ---------------------------------------------------------------------------

export class Hegel {
  private testFn: (tc: TestCase) => void;
  private _settings: Settings;
  private _databaseKey: string | null = null;

  constructor(testFn: (tc: TestCase) => void) {
    this.testFn = testFn;
    this._settings = defaultSettings();
  }

  settings(s: Partial<Settings>): this {
    Object.assign(this._settings, s);
    return this;
  }

  databaseKey(key: string): this {
    this._databaseKey = key;
    return this;
  }

  run(): void {
    const session = HegelSession.get();
    const connection = session.connection;
    const testStream = connection.newStream();

    // Build run_test message
    const suppressNames = this._settings.suppressHealthCheck.map((c) => c as string);

    const databaseKeyValue =
      this._databaseKey !== null ? Buffer.from(this._databaseKey, "utf-8") : null;

    const runTestMsg: Record<string, unknown> = {
      command: "run_test",
      test_cases: this._settings.testCases,
      seed: this._settings.seed,
      stream_id: testStream.streamId,
      database_key: databaseKeyValue,
      derandomize: this._settings.derandomize,
    };

    // Database field
    if (this._settings.database === "disabled") {
      runTestMsg["database"] = null;
    } else if (this._settings.database !== "unset" && this._settings.database !== "disabled") {
      runTestMsg["database"] = this._settings.database;
    }

    if (suppressNames.length > 0) {
      runTestMsg["suppress_health_check"] = suppressNames;
    }

    // Send run_test on control stream
    const controlPayload = encodeValue(runTestMsg);
    const reqId = session.controlStream.sendRequest(controlPayload);
    session.controlStream.receiveReply(reqId);

    // Event loop
    let resultData: Record<string, unknown>;
    const ackNull = encodeValue({ result: null });
    let gotInteresting = false;

    while (true) {
      const [eventId, eventPayload] = testStream.receiveRequest();
      const event = decodeValue(eventPayload) as Record<string, unknown>;
      const eventType = event["event"] as string;

      if (eventType === "test_case") {
        const streamId = event["stream_id"] as number;
        const testCaseStream = connection.connectStream(streamId);

        // Ack BEFORE running the test
        testStream.writeReply(eventId, ackNull);

        const result = runTestCase(connection, testCaseStream, this.testFn, false);

        if (result.status === "interesting") {
          gotInteresting = true;
        }
      } else if (eventType === "test_done") {
        const ackTrue = encodeValue({ result: true });
        testStream.writeReply(eventId, ackTrue);
        resultData = (event["results"] as Record<string, unknown>) ?? {};
        break;
      } else {
        throw new Error(`Unknown event: ${eventType}`);
      }
    }

    // Check for server-side errors
    if (resultData["error"]) {
      throw new Error(`Server error: ${resultData["error"]}`);
    }
    if (resultData["health_check_failure"]) {
      throw new Error(`Health check failure:\n${resultData["health_check_failure"]}`);
    }
    if (resultData["flaky"]) {
      throw new Error(`Flaky test detected: ${resultData["flaky"]}`);
    }

    const nInteresting = (resultData["interesting_test_cases"] as number) ?? 0;

    // Final replays for interesting test cases
    let finalResult: TestCaseResult | null = null;

    for (let i = 0; i < nInteresting; i++) {
      const [eventId, eventPayload] = testStream.receiveRequest();
      const event = decodeValue(eventPayload) as Record<string, unknown>;
      const streamId = event["stream_id"] as number;
      const testCaseStream = connection.connectStream(streamId);

      testStream.writeReply(eventId, ackNull);

      const result = runTestCase(connection, testCaseStream, this.testFn, true);

      if (result.status === "interesting") {
        finalResult = result;
      }
    }

    testStream.close();

    const passed = (resultData["passed"] as boolean) ?? true;
    const testFailed = !passed || gotInteresting;

    if (testFailed) {
      let msg = "unknown";
      if (finalResult && finalResult.status === "interesting") {
        const err = finalResult.error;
        msg = err instanceof Error ? err.message : String(err);
      }
      throw new Error(`Property test failed: ${msg}`);
    }
  }
}

// ---------------------------------------------------------------------------
// runTestCase
// ---------------------------------------------------------------------------

function extractOrigin(error: unknown): string | null {
  if (!(error instanceof Error) || !error.stack) return null;
  const lines = error.stack.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("at ") && !trimmed.includes("node_modules")) {
      return trimmed;
    }
  }
  return null;
}

function runTestCase(
  connection: Connection,
  testStream: Stream,
  testFn: (tc: TestCase) => void,
  isFinal: boolean,
): TestCaseResult {
  const tc = new TestCase(connection, testStream, isFinal);

  let result: TestCaseResult;
  let origin: string | null = null;

  try {
    testFn(tc);
    result = { status: "valid" };
  } catch (e: unknown) {
    if (e instanceof AssumeError) {
      result = { status: "invalid" };
    } else if (e instanceof StopTestError) {
      result = { status: "invalid" };
    } else {
      result = { status: "interesting", error: e };
      origin = extractOrigin(e);

      if (isFinal) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`\n${msg}\n`);
        if (e instanceof Error && e.stack) {
          process.stderr.write(e.stack + "\n");
        }
      }
    }
  }

  // Send mark_complete unless test was aborted (server already closed stream)
  if (!tc.testAborted) {
    const status =
      result.status === "valid" ? "VALID" : result.status === "invalid" ? "INVALID" : "INTERESTING";

    tc.sendMarkComplete({
      command: "mark_complete",
      status,
      origin: origin ?? null,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

/**
 * Run a property-based test.
 *
 * @example
 * ```ts
 * import { hegel, integers } from 'hegel';
 *
 * test('addition is commutative', () => {
 *   hegel((tc) => {
 *     const x = tc.draw(integers());
 *     const y = tc.draw(integers());
 *     expect(x + y).toBe(y + x);
 *   });
 * });
 * ```
 */
export function hegel(testFn: (tc: TestCase) => void, settings?: Partial<Settings>): void {
  const h = new Hegel(testFn);
  if (settings) h.settings(settings);
  h.run();
}
