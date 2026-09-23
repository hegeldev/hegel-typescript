import * as fs from "node:fs";
import * as path from "node:path";
import { inspect } from "node:util";
import { getLibhegel } from "./session.js";
import { Database, Verbosity, type Settings, type TestLocation } from "./runnerCore.js";
import { portableDiagnostics, type RuntimeServices } from "./runtime.js";

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
    reportMultipleFailures: false,
  };
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
}

export const nodeRuntime: RuntimeServices = {
  ...portableDiagnostics,
  getEngine: getLibhegel,
  defaultSettings,
  validateSettings(_settings) {},
  emitAntithesisAssertion,
  reportFinalValue(value, drawNumber) {
    console.error(`var draw_${drawNumber} = ${inspect(value, { depth: null })};`);
  },
};
