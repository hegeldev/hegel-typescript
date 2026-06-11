/**
 * Tests targeting uncovered lines in runner.ts, specifically:
 * - Hegel.run() settings branches (database, suppressHealthCheck)
 * - ServerDataSource error handling paths
 * - Health check failure detection
 * - Flaky test detection
 * - Server error (invalid schema) detection
 */

import { describe, test, expect } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { defaultSettings } from "../src/runner.js";

describe("defaultSettings CI detection", () => {
  test("defaultSettings returns database='disabled' when CI env var is set", () => {
    const original = process.env["CI"];
    try {
      process.env["CI"] = "true";
      const settings = defaultSettings();
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
      const settings = defaultSettings();
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
      const settings = defaultSettings();
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

describe("settings branches", () => {
  test("database: 'disabled' sets database to null", () =>
    hegel.test(
      (tc) => {
        tc.draw(gs.booleans());
      },
      { testCases: 5, database: hegel.Database.disabled },
    ));

  test("database: 'unset' omits database from run_test message", () =>
    hegel.test(
      (tc) => {
        tc.draw(gs.booleans());
      },
      { testCases: 5, database: hegel.Database.unset },
    ));

  test("database: custom path sets database to string", () =>
    hegel.test(
      (tc) => {
        tc.draw(gs.booleans());
      },
      { testCases: 5, database: hegel.Database.fromPath(".hegel/test-db") },
    ));

  test("suppressHealthCheck passes through to server", () =>
    hegel.test(
      (tc) => {
        tc.draw(gs.booleans());
      },
      {
        testCases: 5,
        suppressHealthCheck: [hegel.HealthCheck.FilterTooMuch, hegel.HealthCheck.TooSlow],
      },
    ));
});

describe("server error detection", () => {
  test("invalid schema triggers server error", () => {
    // Send a schema the server rejects (integer with min > max).
    // This exercises the generic server error path in ServerDataSource.sendRequest.
    const badGen = new gs.BasicGenerator({ type: "integer", min_value: 100, max_value: 0 });
    expect(() =>
      hegel.test(
        (tc) => {
          tc.draw(badGen);
        },
        { testCases: 1 },
      ),
    ).toThrow("Server error");
  });

  test("health_check_failure: excessive filtering triggers health check", () => {
    // Filter that rejects >99% of values triggers FilterTooMuch health check.
    expect(() =>
      hegel.test(
        (tc) => {
          const x = tc.draw(gs.integers({ minValue: 0, maxValue: 1000 }));
          tc.assume(x === 500);
        },
        { testCases: 100, database: hegel.Database.disabled },
      ),
    ).toThrow("Health check failure");
  });

  test("flaky test detected", () => {
    // A test that fails on the first run but passes on replay is flaky.
    // Disable the example database so prior tests in this file (which share
    // the Hegel session) do not leave stale entries that mask flaky replay.
    let seen = false;
    expect(() =>
      hegel.test(
        (tc) => {
          const x = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
          if (x > 0 && !seen) {
            seen = true;
            throw new Error("flaky failure");
          }
        },
        { testCases: 100, database: hegel.Database.disabled },
      ),
    ).toThrow("Flaky test detected");
  });

  test("flaky strategy definition from external state", () => {
    // Conditional draws on external state make generation inconsistent across
    // test cases. The server reports this as a flaky strategy definition.
    let calls = 0;
    expect(() =>
      hegel.test(
        (tc) => {
          if (calls % 2 === 0) {
            tc.draw(gs.integers());
          }
          tc.draw(gs.booleans());
          calls++;
        },
        { testCases: 2, database: hegel.Database.disabled },
      ),
    ).toThrow("Flaky test detected");
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

  test("error_response exercises server error path", () =>
    withTestMode("error_response", () =>
      hegel.test(
        (tc) => {
          tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
        },
        { testCases: 10 },
      ),
    ));

  test("stop_test_on_generate exercises StopTest path", () =>
    withTestMode("stop_test_on_generate", () =>
      hegel.test(
        (tc) => {
          tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
        },
        { testCases: 10 },
      ),
    ));
});
