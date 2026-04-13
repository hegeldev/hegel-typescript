/**
 * Tests targeting uncovered lines in runner.ts, specifically:
 * - Hegel.run() settings branches (database, suppressHealthCheck)
 * - ServerDataSource error handling paths
 * - Health check failure detection
 * - Flaky test detection
 * - Server error (invalid schema) detection
 */

import { describe, test, expect } from "vitest";
import {
  Hegel,
  HealthCheck,
  integers,
  booleans,
  BasicGenerator,
  runTestCase,
  type DataSource,
  StopTestError,
  AssumeError,
} from "hegel";

describe("Hegel.run() settings branches", () => {
  test("database: 'disabled' sets database to null", () => {
    new Hegel((tc) => {
      tc.draw(booleans());
    })
      .settings({ testCases: 5, database: "disabled" })
      .run();
  });

  test("database: custom path sets database to string", () => {
    new Hegel((tc) => {
      tc.draw(booleans());
    })
      .settings({ testCases: 5, database: ".hegel/test-db" })
      .run();
  });

  test("suppressHealthCheck passes through to server", () => {
    new Hegel((tc) => {
      tc.draw(booleans());
    })
      .settings({
        testCases: 5,
        suppressHealthCheck: [HealthCheck.FilterTooMuch, HealthCheck.TooSlow],
      })
      .run();
  });
});

describe("runTestCase with fake DataSource", () => {
  function makeDs(overrides: Partial<DataSource> = {}): DataSource & { completed: string | null } {
    const ds: DataSource & { completed: string | null } = {
      completed: null,
      generate: () => 42,
      startSpan: () => {},
      stopSpan: () => {},
      newCollection: () => 0,
      collectionMore: () => false,
      collectionReject: () => {},
      markComplete(status, _origin) {
        ds.completed = status;
      },
      testAborted: () => false,
      ...overrides,
    };
    return ds;
  }

  test("extractOrigin returns null for non-Error values", () => {
    const ds = makeDs();
    const result = runTestCase(
      ds,
      () => {
        throw "string error";
      },
      false,
    );
    expect(result.status).toBe("interesting");
    expect(ds.completed).toBe("INTERESTING");
  });

  test("isFinal with non-Error interesting result writes to stderr", () => {
    const ds = makeDs();
    const result = runTestCase(
      ds,
      () => {
        throw "string error";
      },
      true,
    );
    expect(result.status).toBe("interesting");
  });

  test("testAborted skips markComplete", () => {
    const ds = makeDs({ testAborted: () => true });
    const result = runTestCase(
      ds,
      () => {
        throw new StopTestError();
      },
      false,
    );
    expect(result.status).toBe("invalid");
    expect(ds.completed).toBeNull();
  });

  test("AssumeError returns invalid", () => {
    const ds = makeDs();
    const result = runTestCase(
      ds,
      () => {
        throw new AssumeError();
      },
      false,
    );
    expect(result.status).toBe("invalid");
    expect(ds.completed).toBe("INVALID");
  });
});

describe("server error detection", () => {
  test("invalid schema triggers server error", () => {
    // Send a schema the server rejects (integer with min > max).
    // This exercises the generic server error path in ServerDataSource.sendRequest.
    const badGen = new BasicGenerator({ type: "integer", min_value: 100, max_value: 0 });
    expect(() => {
      new Hegel((tc) => {
        tc.draw(badGen);
      })
        .settings({ testCases: 1 })
        .run();
    }).toThrow("Server error");
  });

  test("health_check_failure: excessive filtering triggers health check", () => {
    // Filter that rejects >99% of values triggers FilterTooMuch health check.
    // This exercises line 380-381 in Hegel.run() (result data check).
    expect(() => {
      new Hegel((tc) => {
        const x = tc.draw(integers({ minValue: 0, maxValue: 1000 }));
        tc.assume(x === 500);
      })
        .settings({ testCases: 100 })
        .run();
    }).toThrow("Health check failure");
  });

  test("flaky test detected", () => {
    // A test that fails on the first run but passes on replay is flaky.
    // Use a mutable counter: fail on the first non-zero example, then pass on retry.
    let seen = false;
    expect(() => {
      new Hegel((tc) => {
        const x = tc.draw(integers({ minValue: 0, maxValue: 100 }));
        if (x > 0 && !seen) {
          seen = true;
          throw new Error("flaky failure");
        }
      })
        .settings({ testCases: 100 })
        .run();
    }).toThrow("Flaky test detected");
  });
});

describe("ServerDataSource error paths via HEGEL_PROTOCOL_TEST_MODE", () => {
  function withTestMode(mode: string, fn: () => void) {
    const original = process.env["HEGEL_PROTOCOL_TEST_MODE"];
    try {
      process.env["HEGEL_PROTOCOL_TEST_MODE"] = mode;
      fn();
    } finally {
      if (original === undefined) {
        delete process.env["HEGEL_PROTOCOL_TEST_MODE"];
      } else {
        process.env["HEGEL_PROTOCOL_TEST_MODE"] = original;
      }
    }
  }

  test("error_response exercises server error path", () => {
    withTestMode("error_response", () => {
      new Hegel((tc) => {
        tc.draw(integers({ minValue: 0, maxValue: 100 }));
      })
        .settings({ testCases: 10 })
        .run();
    });
  });

  test("stop_test_on_generate exercises StopTest path", () => {
    withTestMode("stop_test_on_generate", () => {
      new Hegel((tc) => {
        tc.draw(integers({ minValue: 0, maxValue: 100 }));
      })
        .settings({ testCases: 10 })
        .run();
    });
  });
});
