/**
 * Tests targeting uncovered lines in runner.ts, specifically:
 * - Hegel.run() settings branches (database, suppressHealthCheck)
 * - hegel.ServerDataSource error handling paths
 * - Health check failure detection
 * - Flaky test detection
 * - Server error (invalid schema) detection
 */

import { describe, test, expect } from "vitest";
import * as hegel from "hegel";
import * as gs from "hegel/generators";

describe("defaultSettings CI detection", () => {
  test("defaultSettings returns database='disabled' when CI env var is set", () => {
    const original = process.env["CI"];
    try {
      process.env["CI"] = "true";
      const settings = hegel.defaultSettings();
      expect(settings.database).toEqual(hegel.Database.disabled);
      expect(settings.derandomize).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env["CI"];
      } else {
        process.env["CI"] = original;
      }
    }
  });

  test("defaultSettings detects CI via value-matched env vars (e.g. GITHUB_ACTIONS=true)", () => {
    // This test covers the `value !== null` branch in isInCI() (runner.ts line 64)
    // where CI vars with specific expected values are checked.
    const savedVars: Record<string, string | undefined> = {};
    // Save and clear ALL CI detection vars so only our target triggers
    const nullVars = [
      "CI",
      "BITBUCKET_COMMIT",
      "CODEBUILD_BUILD_ID",
      "GITLAB_CI",
      "HEROKU_TEST_RUN_ID",
      "TEAMCITY_VERSION",
      "bamboo.buildKey",
    ];
    const valueVars = ["BUILDKITE", "CIRCLECI", "CIRRUS_CI", "GITHUB_ACTIONS", "TF_BUILD"];
    const allVars = [...nullVars, ...valueVars];
    for (const key of allVars) {
      savedVars[key] = process.env[key];
      delete process.env[key];
    }
    try {
      // Set GITHUB_ACTIONS which expects value "true"
      process.env["GITHUB_ACTIONS"] = "true";
      const settings = hegel.defaultSettings();
      expect(settings.database).toEqual(hegel.Database.disabled);
      expect(settings.derandomize).toBe(true);
    } finally {
      for (const key of allVars) {
        if (savedVars[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedVars[key];
        }
      }
    }
  });

  test("defaultSettings returns non-CI defaults when no CI env vars are set", () => {
    // This test covers the branch where isInCI() returns false,
    // ensuring the `.some()` callback returns false for value-matched vars
    // when the value doesn't match.
    const savedVars: Record<string, string | undefined> = {};
    const allVars = [
      "CI",
      "BITBUCKET_COMMIT",
      "CODEBUILD_BUILD_ID",
      "GITLAB_CI",
      "HEROKU_TEST_RUN_ID",
      "TEAMCITY_VERSION",
      "bamboo.buildKey",
      "BUILDKITE",
      "CIRCLECI",
      "CIRRUS_CI",
      "GITHUB_ACTIONS",
      "TF_BUILD",
    ];
    for (const key of allVars) {
      savedVars[key] = process.env[key];
      delete process.env[key];
    }
    try {
      const settings = hegel.defaultSettings();
      expect(settings.database).toEqual(hegel.Database.unset);
      expect(settings.derandomize).toBe(false);
    } finally {
      for (const key of allVars) {
        if (savedVars[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedVars[key];
        }
      }
    }
  });
});

describe("Hegel.run() settings branches", () => {
  test("database: 'disabled' sets database to null", () => {
    new hegel.Hegel((tc) => {
      tc.draw(gs.booleans());
    })
      .settings({ testCases: 5, database: hegel.Database.disabled })
      .run();
  });

  test("database: 'unset' omits database from run_test message", () => {
    new hegel.Hegel((tc) => {
      tc.draw(gs.booleans());
    })
      .settings({ testCases: 5, database: hegel.Database.unset })
      .run();
  });

  test("database: custom path sets database to string", () => {
    new hegel.Hegel((tc) => {
      tc.draw(gs.booleans());
    })
      .settings({ testCases: 5, database: hegel.Database.fromPath(".hegel/test-db") })
      .run();
  });

  test("suppressHealthCheck passes through to server", () => {
    new hegel.Hegel((tc) => {
      tc.draw(gs.booleans());
    })
      .settings({
        testCases: 5,
        suppressHealthCheck: [hegel.HealthCheck.FilterTooMuch, hegel.HealthCheck.TooSlow],
      })
      .run();
  });
});

describe("runTestCase with fake DataSource", () => {
  function makeDs(
    overrides: Partial<hegel.DataSource> = {},
  ): hegel.DataSource & { completed: string | null } {
    const ds: hegel.DataSource & { completed: string | null } = {
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
    const result = hegel.runTestCase(
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
    const result = hegel.runTestCase(
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
    const result = hegel.runTestCase(
      ds,
      () => {
        throw new hegel.StopTestError();
      },
      false,
    );
    expect(result.status).toBe("invalid");
    expect(ds.completed).toBeNull();
  });

  test("AssumeError returns invalid", () => {
    const ds = makeDs();
    const result = hegel.runTestCase(
      ds,
      () => {
        throw new hegel.AssumeError();
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
    // This exercises the generic server error path in hegel.ServerDataSource.sendRequest.
    const badGen = new gs.BasicGenerator({ type: "integer", min_value: 100, max_value: 0 });
    expect(() => {
      new hegel.Hegel((tc) => {
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
      new hegel.Hegel((tc) => {
        const x = tc.draw(gs.integers({ minValue: 0, maxValue: 1000 }));
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
      new hegel.Hegel((tc) => {
        const x = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
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
      new hegel.Hegel((tc) => {
        tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
      })
        .settings({ testCases: 10 })
        .run();
    });
  });

  test("stop_test_on_generate exercises StopTest path", () => {
    withTestMode("stop_test_on_generate", () => {
      new hegel.Hegel((tc) => {
        tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
      })
        .settings({ testCases: 10 })
        .run();
    });
  });
});
