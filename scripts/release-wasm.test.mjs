import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ROOT, PIN, preparedBytes, requirePublished } from "./wasm-artifact.mjs";
import { PLATFORMS } from "./fetch-libhegel.mjs";

test("release preparation verifies remote evidence and sidecars before accepting bytes", () => {
  // Simulated GitHub/network responses test the unreleased code path, not release availability.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hegel-release-preparation-test-"));
  try {
    for (const file of [
      "scripts/wasm-artifact.mjs",
      "scripts/fetch-libhegel.mjs",
      "src/libhegel-version.ts",
    ]) {
      const dest = path.join(temp, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(ROOT, file), dest);
    }
    const pin = { ...PIN, published: true, release: { tag: `libhegel-v${PIN.version}` } };
    fs.mkdirSync(path.join(temp, "src/browser"));
    fs.writeFileSync(path.join(temp, "src/browser/artifact.json"), JSON.stringify(pin));
    fs.writeFileSync(path.join(temp, "bytes.wasm"), preparedBytes());
    fs.writeFileSync(
      path.join(temp, "gh"),
      `#!${process.execPath}
const pin = ${JSON.stringify(pin)};
const scenario = process.env.SCENARIO;
let result;
if (process.argv[2] === 'release') result = {tagName: pin.release.tag, isDraft: scenario === 'draft', isPrerelease: scenario === 'prerelease', assets: (scenario === 'missing' ? [] : [pin.asset, pin.asset + '.sha256']).map(name => ({name}))};
else if (process.argv[3].includes('/git/ref/')) result = {object: {type: 'tag', sha: 'annotated-tag'}};
else if (process.argv[3].includes('/git/tags/')) result = {object: {type: 'commit', sha: scenario === 'source' ? 'wrong-source' : pin.source}};
else if (process.argv[3].includes('/compare/') && process.argv[4] === '--jq' && process.argv[5] === '.status') result = scenario === 'unmerged' ? 'behind' : 'ahead';
else throw new Error('unexpected gh invocation: ' + process.argv.slice(2).join(' '));
// gh prints --jq string results raw, without JSON quotes.
console.log(typeof result === 'string' ? result : JSON.stringify(result));
`,
    );
    fs.chmodSync(path.join(temp, "gh"), 0o755);
    fs.writeFileSync(
      path.join(temp, "network.mjs"),
      `
import fs from 'node:fs';
const pin = ${JSON.stringify(pin)};
globalThis.fetch = async url => {
  const scenario = process.env.SCENARIO;
  if (scenario === 'http') return new Response('not found', {status: 404});
  return new Response(url.endsWith('.sha256') ? (scenario === 'checksum' ? 'wrong' : pin.sha256 + '  ' + pin.asset + '\\n') : (scenario === 'bytes' ? new Uint8Array() : fs.readFileSync('bytes.wasm')));
};
`,
    );
    const run = (mode, scenario = "valid") =>
      spawnSync(
        process.execPath,
        ["--import", "./network.mjs", "scripts/wasm-artifact.mjs", mode],
        {
          cwd: temp,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: temp + path.delimiter + process.env.PATH,
            SCENARIO: scenario,
          },
        },
      );
    for (const [scenario, message] of Object.entries({
      draft: /stable/,
      prerelease: /stable/,
      missing: /missing/,
      source: /pinned source/,
      unmerged: /not merged/,
      checksum: /sidecar/,
      bytes: /checksum/,
      http: /HTTP 404/,
    })) {
      const result = run("release", scenario);
      assert.notEqual(result.status, 0, scenario);
      assert.match(result.stderr, message, scenario);
      assert(!fs.existsSync(path.join(temp, "native")), "must not save rejected release bytes");
    }
    const result = run("release");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(run("copy").status, 0);
    assert.equal(run("publish-check").status, 0);
    fs.writeFileSync(path.join(temp, "dist/browser", pin.asset), "tampered");
    assert.match(run("publish-check").stderr, /differs from the prepared release/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("update-libhegel regenerates the native and Wasm pins from one release", () => {
  // A fake gh/network stand in for hegel-rust; this is the path
  // .github/scripts/bump_hegel_rust.py takes for every engine bump.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hegel-update-libhegel-test-"));
  try {
    for (const file of [
      "scripts/update-libhegel.mjs",
      "scripts/wasm-artifact.mjs",
      "scripts/fetch-libhegel.mjs",
      "src/libhegel-version.ts",
      "src/browser/artifact.json",
      "src/browser/artifact.ts",
    ]) {
      const dest = path.join(temp, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(ROOT, file), dest);
    }
    const source = "b".repeat(40);
    const sha256 = "c".repeat(64);
    const assets = [...PLATFORMS.map((p) => p.asset), PIN.asset, `${PIN.asset}.sha256`];
    fs.writeFileSync(
      path.join(temp, "gh"),
      `#!${process.execPath}
const assets = ${JSON.stringify(assets)};
const scenario = process.env.SCENARIO;
let result;
if (process.argv[2] === 'release') result = {tagName: process.env.TAG ?? 'libhegel-v9.9.9', assets: assets.filter(name => scenario !== 'no-wasm' || !name.includes('wasm')).map(name => ({name}))};
else if (process.argv[3].includes('/git/ref/')) result = {object: {type: 'tag', sha: 'annotated-tag'}};
else if (process.argv[3].includes('/git/tags/')) result = {object: {type: 'commit', sha: ${JSON.stringify(source)}}};
else throw new Error('unexpected gh invocation: ' + process.argv.slice(2).join(' '));
console.log(JSON.stringify(result));
`,
    );
    fs.chmodSync(path.join(temp, "gh"), 0o755);
    fs.writeFileSync(
      path.join(temp, "network.mjs"),
      `
globalThis.fetch = async url => {
  if (!url.endsWith('/libhegel-v9.9.9/${PIN.asset}.sha256')) return new Response('not found', {status: 404});
  return new Response(process.env.SCENARIO === 'sidecar' ? 'garbage' : '${sha256}  ${PIN.asset}\\n');
};
`,
    );
    const run = (want, env = {}) =>
      spawnSync(
        process.execPath,
        ["--import", "./network.mjs", "scripts/update-libhegel.mjs", want],
        {
          cwd: temp,
          encoding: "utf8",
          env: { ...process.env, PATH: temp + path.delimiter + process.env.PATH, ...env },
        },
      );
    const read = (file) => fs.readFileSync(path.join(temp, file), "utf8");
    const before = ["src/libhegel-version.ts", "src/browser/artifact.json"].map(read);
    assert.match(run("9.9.9", { SCENARIO: "no-wasm" }).stderr, /missing assets: .*wasm/);
    assert.match(run("9.9.9", { SCENARIO: "sidecar" }).stderr, /Malformed checksum sidecar/);
    assert.match(run("9.9.9", { TAG: "v9.9.9" }).stderr, /not a libhegel release/);
    assert.match(run("9.9.8").stderr, /requested release libhegel-v9.9.8 but got tag/);
    assert.deepEqual(
      ["src/libhegel-version.ts", "src/browser/artifact.json"].map(read),
      before,
      "a rejected release must leave the pins alone",
    );

    const result = run("libhegel-v9.9.9");
    assert.equal(result.status, 0, result.stderr);
    assert.match(read("src/libhegel-version.ts"), /LIBHEGEL_VERSION = "9\.9\.9";/);
    const pin = JSON.parse(read("src/browser/artifact.json"));
    assert.deepEqual(pin, {
      version: "9.9.9",
      source,
      sha256,
      target: PIN.target,
      asset: PIN.asset,
      published: true,
      release: { tag: "libhegel-v9.9.9" },
    });
    requirePublished(pin);
    const artifact = read("src/browser/artifact.ts");
    assert.match(artifact, /DO NOT EDIT/);
    assert.match(artifact, new RegExp(`sha256: ${JSON.stringify(sha256)}`));
    assert.match(artifact, new RegExp(`asset: ${JSON.stringify(PIN.asset)}`));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
