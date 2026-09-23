import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ROOT, PIN, preparedBytes } from "./wasm-artifact.mjs";

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
