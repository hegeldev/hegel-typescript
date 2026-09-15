import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ROOT,
  PIN,
  sha256,
  verifyBytes,
  verifyProvenance,
  requirePublished,
  preparedBytes,
} from "./wasm-artifact.mjs";

test("the preparation receipt and artifact match the single pin", () => {
  verifyBytes(preparedBytes());
  assert.equal(PIN.version, "0.38.1");
  assert.equal(PIN.published, true);
  assert.deepEqual(PIN.release, { tag: "v0.38.1" });
});

test("rejects corrupt bytes and stale or mismatched provenance", () => {
  assert.throws(() => verifyBytes(new Uint8Array()), /checksum/);
  const invalid = Buffer.from("not wasm");
  assert.throws(() => verifyBytes(invalid, { sha256: sha256(invalid) }), /Invalid Wasm/);
  assert.throws(() => verifyProvenance({}), /provenance/);
  const receipt = {
    pinSha256: sha256(JSON.stringify(PIN)),
    sha256: PIN.sha256,
    mode: "release",
  };
  verifyProvenance(receipt);
  assert.throws(() => verifyProvenance({ ...receipt, sha256: "wrong" }), /provenance/);
  assert.throws(() => verifyProvenance({ ...receipt, mode: "development" }), /provenance/);
  requirePublished(PIN);
  for (const bad of [
    { ...PIN, published: false },
    { ...PIN, release: null },
    { ...PIN, source: "main" },
    { ...PIN, release: { tag: "latest" } },
  ]) {
    assert.throws(() => requirePublished(bad), /Publication blocked/);
  }
});

test("the published Wasm and native pins agree", () => {
  const version = fs.readFileSync(path.join(ROOT, "src/libhegel-version.ts"), "utf8");
  assert.match(version, new RegExp(`LIBHEGEL_VERSION = ${JSON.stringify(PIN.version)}`));
  requirePublished(PIN);
});

test("build preparation is offline and rejects missing, stale or corrupt prepared artifacts", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hegel-package-script-"));
  try {
    for (const file of [
      "scripts/wasm-artifact.mjs",
      "scripts/fetch-libhegel.mjs",
      "src/browser/artifact.json",
      "src/libhegel-version.ts",
    ]) {
      const dest = path.join(temp, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(ROOT, file), dest);
    }
    const copy = () =>
      spawnSync("node", ["scripts/wasm-artifact.mjs", "copy"], { cwd: temp, encoding: "utf8" });
    assert.match(copy().stderr, /ENOENT/);
    const dest = path.join(temp, "native/wasm", PIN.sha256, PIN.asset);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "corrupt");
    assert.match(copy().stderr, /checksum/);
    fs.writeFileSync(dest, preparedBytes());
    fs.writeFileSync(`${dest}.json`, "{}");
    assert.match(copy().stderr, /provenance/);
    fs.writeFileSync(
      `${dest}.json`,
      JSON.stringify({
        pinSha256: sha256(JSON.stringify(PIN)),
        sha256: PIN.sha256,
        mode: "release",
      }),
    );
    assert.equal(copy().status, 0);
    assert.deepEqual(fs.readFileSync(path.join(temp, "dist/browser", PIN.asset)), preparedBytes());
    fs.writeFileSync(
      path.join(temp, "src/libhegel-version.ts"),
      'export const LIBHEGEL_VERSION = "0.0.0";',
    );
    assert.match(copy().stderr, /version pins differ/);
    const usage = spawnSync("node", ["scripts/wasm-artifact.mjs"], { cwd: temp, encoding: "utf8" });
    assert.match(usage.stderr, /Choose dev/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("conditional exports keep node ahead of browser and default to browser", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json")));
  assert.deepEqual(Object.keys(pkg.exports["."]), ["types", "node", "browser", "default"]);
  assert.equal(pkg.exports["."].default, pkg.exports["."].browser);
  assert.notEqual(pkg.exports["."].node, pkg.exports["."].browser);
  assert.equal(pkg.exports["./libhegel.wasm"], `./dist/browser/${PIN.asset}`);
  const resolved = execFileSync(
    "node",
    [
      "--conditions=browser",
      "--input-type=module",
      "-e",
      "console.log(import.meta.resolve('@hegeldev/hegel'))",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert(
    resolved.trim().endsWith("/dist/index.js"),
    "Node must win even when browser is also enabled",
  );
});
