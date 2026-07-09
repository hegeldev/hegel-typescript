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
import { defaultSettings, NativeDataSource } from "../src/runner.js";
import { Libhegel, Status, NativeVerbosity } from "../src/libhegel.js";
import { Labels } from "../src/testCase.js";
import { testLibPath } from "./libPath.js";

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

  test("defaultSettings detects Bamboo CI via bamboo_buildKey", () => {
    // ci-info's convention for Bamboo is the env var `bamboo_buildKey`
    // (Bamboo exposes its `bamboo.buildKey` property with `_`, since `.`
    // is not valid in environment variable names).
    const original = process.env["bamboo_buildKey"];
    try {
      process.env["bamboo_buildKey"] = "PROJ-PLAN-1";
      const settings = defaultSettings();
      expect(settings.database).toEqual(hegel.Database.disabled);
      expect(settings.derandomize).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env["bamboo_buildKey"];
      } else {
        process.env["bamboo_buildKey"] = original;
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
      "bamboo_buildKey",
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
      "bamboo_buildKey",
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
      expect(settings.reportMultipleFailures).toBe(false);
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

  test("suppressHealthCheck passes through to the engine", () =>
    hegel.test(
      (tc) => {
        tc.draw(gs.booleans());
      },
      {
        testCases: 5,
        suppressHealthCheck: [hegel.HealthCheck.FilterTooMuch, hegel.HealthCheck.TooSlow],
      },
    ));

  test("reportMultipleFailures: true passes through to the engine", () =>
    hegel.test(
      (tc) => {
        tc.draw(gs.booleans());
      },
      { testCases: 5, reportMultipleFailures: true },
    ));

  test("reportMultipleFailures: false passes through to the engine", () =>
    hegel.test(
      (tc) => {
        tc.draw(gs.booleans());
      },
      { testCases: 5, reportMultipleFailures: false },
    ));

  test("an explicit seed makes the run reproducible", () =>
    hegel.test(
      (tc) => {
        tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
      },
      { testCases: 5, seed: 42 },
    ));

  test("every verbosity level is accepted", () => {
    for (const verbosity of [
      hegel.Verbosity.Quiet,
      hegel.Verbosity.Normal,
      hegel.Verbosity.Verbose,
      hegel.Verbosity.Debug,
    ]) {
      hegel.test(
        (tc) => {
          tc.draw(gs.booleans());
        },
        { testCases: 2, verbosity },
      );
    }
  });
});

describe("NativeDataSource collection rejection", () => {
  test("rejects elements with and without a reason", () => {
    const lib = Libhegel.load(testLibPath());
    const ctx = lib.newContext();
    const settings = lib.newSettings();
    lib.setVerbosity(settings, NativeVerbosity.QUIET);
    lib.setDatabase(ctx, settings, "");
    const run = lib.runStart(ctx, settings);
    try {
      const tc = lib.nextTestCase(ctx, run);
      expect(tc).not.toBeNull();
      const ds = new NativeDataSource(lib, ctx, tc);
      ds.startSpan(Labels.SET);
      const id = ds.newCollection(2, 5);
      const intSchema = { type: "integer", min_value: 0n, max_value: 100n };
      let rejects = 0;
      while (ds.collectionMore(id)) {
        ds.startSpan(Labels.SET_ELEMENT);
        ds.generate(intSchema);
        ds.stopSpan(false);
        if (rejects < 2) {
          // First reject omits the reason (why ?? null), second supplies one.
          ds.collectionReject(id, rejects === 0 ? undefined : "duplicate");
          rejects++;
        }
      }
      ds.stopSpan(false);
      ds.markComplete(Status.VALID, null);
      expect(rejects).toBe(2);
    } finally {
      lib.freeRun(run);
      lib.freeSettings(settings);
      lib.freeContext(ctx);
    }
  });
});

describe("non-Error failures", () => {
  test("a thrown non-Error value is reported", () => {
    expect(() =>
      hegel.test((tc) => {
        tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
        throw "boom-string";
      }),
    ).toThrow(/Property test failed: boom-string/);
  });
});

describe("engine error reporting", () => {
  test("a malformed schema surfaces as a thrown error", () => {
    // An integer schema with no bounds is rejected by the engine on the first
    // draw; the failing draw propagates out of hegel.test.
    const badGen = new gs.BasicGenerator({ type: "integer" });
    expect(() =>
      hegel.test(
        (tc) => {
          tc.draw(badGen);
        },
        { testCases: 1 },
      ),
    ).toThrow(/Property test failed/);
  });

  test("excessive filtering trips the FilterTooMuch health check (run-level error)", () => {
    // Rejecting >99% of values produces a FilterTooMuch health-check failure,
    // reported by the runner as a run-level error.
    expect(() =>
      hegel.test((tc) => {
        const x = tc.draw(gs.integers({ minValue: 0, maxValue: 1000 }));
        tc.assume(x === 500);
      }),
    ).toThrow(/FilterTooMuch/);
  });

  test("a nondeterministic (flaky) test is reported as a failure", () => {
    // Fails the first time a positive value is seen, then passes on replay.
    let seen = false;
    expect(() =>
      hegel.test((tc) => {
        const x = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
        if (x > 0 && !seen) {
          seen = true;
          throw new Error("flaky failure");
        }
      }),
    ).toThrow(/Property test failed/);
  });
});
