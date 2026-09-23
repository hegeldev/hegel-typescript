// Checks on the packaging scripts that need no network: checksum sidecar
// parsing, the conditional export map, and the engine bump's release checks
// (against a fake `gh`). `npm run test:browser` covers the packed package.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { PLATFORMS, WASM_ASSET, sha256, sidecarDigest } from "./fetch-libhegel.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("checksum sidecars are parsed strictly", () => {
  const hex = "c".repeat(64);
  assert.equal(sidecarDigest(`${hex}  ${WASM_ASSET}\n`, WASM_ASSET), hex);
  assert.equal(sidecarDigest(`${hex} *${WASM_ASSET}`, WASM_ASSET), hex);
  assert.equal(sidecarDigest(hex, WASM_ASSET), hex);
  assert.throws(() => sidecarDigest(`${hex}  other.wasm`, WASM_ASSET), /malformed/);
  assert.throws(() => sidecarDigest(`${hex.slice(1)}  ${WASM_ASSET}`, WASM_ASSET), /malformed/);
  assert.throws(() => sidecarDigest("garbage", WASM_ASSET), /malformed/);
  assert.equal(
    sha256(Buffer.alloc(0)),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("conditional exports keep node ahead of browser and default to browser", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json")));
  assert.deepEqual(Object.keys(pkg.exports["."]), ["types", "node", "browser", "default"]);
  assert.equal(pkg.exports["."].default, pkg.exports["."].browser);
  assert.notEqual(pkg.exports["."].node, pkg.exports["."].browser);
  assert.equal(pkg.exports["./libhegel.wasm"], `./dist/browser/${WASM_ASSET}`);
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

test("update-libhegel only pins releases that publish every asset with its sidecar", () => {
  // A fake gh stands in for hegel-rust; this is the path
  // .github/scripts/bump_hegel_rust.py takes for every engine bump.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hegel-update-libhegel-test-"));
  try {
    for (const file of [
      "scripts/update-libhegel.mjs",
      "scripts/fetch-libhegel.mjs",
      "src/libhegel-version.ts",
    ]) {
      const dest = path.join(temp, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(ROOT, file), dest);
    }
    const assets = [...PLATFORMS.map((p) => p.asset), WASM_ASSET].flatMap((a) => [
      a,
      `${a}.sha256`,
    ]);
    fs.writeFileSync(
      path.join(temp, "gh"),
      `#!${process.execPath}
const assets = ${JSON.stringify(assets)};
const drop = process.env.DROP ?? "";
if (process.argv[2] !== 'release') throw new Error('unexpected gh invocation: ' + process.argv.slice(2).join(' '));
console.log(JSON.stringify({tagName: process.env.TAG ?? 'libhegel-v9.9.9', assets: assets.filter(name => name !== drop).map(name => ({name}))}));
`,
    );
    fs.chmodSync(path.join(temp, "gh"), 0o755);
    const run = (want, env = {}) =>
      spawnSync(process.execPath, ["scripts/update-libhegel.mjs", want], {
        cwd: temp,
        encoding: "utf8",
        env: { ...process.env, PATH: temp + path.delimiter + process.env.PATH, ...env },
      });
    const pin = () => fs.readFileSync(path.join(temp, "src/libhegel-version.ts"), "utf8");
    const before = pin();
    assert.match(run("9.9.9", { DROP: WASM_ASSET }).stderr, /missing assets: .*wasm/);
    assert.match(run("9.9.9", { DROP: `${WASM_ASSET}.sha256` }).stderr, /wasm\.sha256/);
    assert.match(run("9.9.9", { DROP: PLATFORMS[0].asset }).stderr, /missing assets/);
    assert.match(run("9.9.9", { TAG: "v9.9.9" }).stderr, /not a libhegel release/);
    assert.match(run("9.9.8").stderr, /requested release libhegel-v9.9.8 but got tag/);
    assert.equal(pin(), before, "a rejected release must leave the pin alone");

    const result = run("libhegel-v9.9.9");
    assert.equal(result.status, 0, result.stderr);
    assert.match(pin(), /LIBHEGEL_VERSION = "9\.9\.9";/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
