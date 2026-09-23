import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { build as viteBuild } from "vite";
import webpack from "webpack";
import { build as esbuild } from "esbuild";
import { rollup } from "rollup";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { PLATFORMS, WASM_ASSET, fetchWasm, sha256 } from "./fetch-libhegel.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hegel-browser-package-")));
const run = (command, args, cwd = temp, env = process.env) =>
  execFileSync(command, args, { cwd, encoding: "utf8", env });
const write = (name, text) => fs.writeFileSync(path.join(temp, name), text);
const forbidden =
  /(?:\bkoffi\b|\bnode:|\bprocess\b|\bBuffer\b|[/\\](?:locate|libhegel|nodeRuntime|session)\.js|\.node\b|__vite-browser-external|node-polyfill)/;
function checkGraph(ids) {
  assert(
    ids.some((id) => id.includes("browser/index.js")),
    "browser composition root not selected",
  );
  for (const id of ids) assert(!forbidden.test(id), `Node dependency in browser graph: ${id}`);
}
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(dir, entry.name);
    return entry.isDirectory() ? files(name) : [name];
  });
}

let browser;
try {
  // The pinned release's Wasm module, as fetched (and checksum-verified) into native/.
  const wasmBytes = fs.readFileSync(await fetchWasm());
  const verifyBytes = (bytes) => {
    assert(Buffer.from(bytes).equals(wasmBytes), "Wasm differs from the pinned release asset");
    assert(WebAssembly.validate(bytes), "Invalid Wasm");
  };
  const packOutput = run("npm", ["pack", "--json", "--pack-destination", temp], ROOT);
  const packed = JSON.parse(packOutput.slice(packOutput.indexOf("[\n")))[0];
  assert(packed.files.some((f) => f.path === `dist/browser/${WASM_ASSET}`));
  assert(
    !packed.files.some((f) =>
      /(?:AGENT_HANDOFF|provenance|native\/|\.dylib$|\.node$)/.test(f.path),
    ),
  );
  run("node", ["scripts/make-platform-packages.mjs", "--host", "--offline"], ROOT);
  const host = PLATFORMS.find(
    ({ platform, arch }) => platform === process.platform && arch === process.arch,
  );
  assert(host, `unsupported consumer-test host ${process.platform}/${process.arch}`);
  const platformDir = path.join(ROOT, "platform-packages", `hegel-${host.platform}-${host.arch}`);
  const platformPackOutput = run(
    "npm",
    ["pack", "--json", "--pack-destination", temp],
    platformDir,
  );
  const platformPack = JSON.parse(platformPackOutput.slice(platformPackOutput.indexOf("[\n")))[0];
  write("package.json", JSON.stringify({ private: true, type: "module" }));
  // Install real tarballs, not file-directory dependencies or source aliases.
  // The direct host package replaces the old registry package at this
  // pre-release version and proves native lookup without an env override.
  run("npm", [
    "install",
    "--no-audit",
    "--no-fund",
    path.join(temp, packed.filename),
    path.join(temp, platformPack.filename),
  ]);
  const require = createRequire(path.join(temp, "package.json"));
  const wasm = require.resolve("@hegeldev/hegel/libhegel.wasm");
  verifyBytes(fs.readFileSync(wasm));
  assert(require.resolve("@hegeldev/hegel").endsWith("/dist/index.js"));
  write(
    "native.mjs",
    `
    import * as h from '@hegeldev/hegel';
    import * as gs from '@hegeldev/hegel/generators';
    import assert from 'node:assert/strict';
    import * as fs from 'node:fs';
    import path from 'node:path';
    h.test(tc => {
      assert.equal(tc.draw(gs.integers({ minValue: 7, maxValue: 7 })), 7);
      assert.match(tc.draw(gs.uuids({version: 4})), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
    await h.testAsync(async tc => { await Promise.resolve(); assert.equal(typeof tc.draw(gs.booleans()), 'boolean'); });
    let failure;
    try { h.test(tc => { const n = tc.draw(gs.integers({minValue: 0, maxValue: 100})); if (n >= 50) throw new Error('n=' + n); }, {seed: 42}); } catch (error) { failure = error.message; }
    assert.ok(failure === 'n=50' || failure?.startsWith('n=50 ['), 'native shrink and final replay: ' + failure);
    const database = path.join(process.cwd(), 'node-database');
    let databaseFailure;
    try { h.test(tc => { const n = tc.draw(gs.integers({minValue: 0, maxValue: 10})); if (n >= 5) throw new Error('persist me'); }, {seed: 42, database: h.Database.fromPath(database)}); } catch (error) { databaseFailure = error.message; }
    assert.ok(databaseFailure === 'persist me' || databaseFailure?.startsWith('persist me ['), 'native database failure: ' + databaseFailure);
    assert.ok(fs.readdirSync(database, {recursive: true, withFileTypes: true}).some(entry => entry.isFile()), 'native database did not persist a corpus file');
    console.log(JSON.stringify({root: Object.keys(h).sort(), generators: Object.keys(gs).sort()}));
  `,
  );
  const consumerEnv = { ...process.env };
  delete consumerEnv.HEGEL_LIBHEGEL_PATH;
  const native = JSON.parse(run("node", ["native.mjs"], temp, consumerEnv).trim());
  console.log(`Packed Node smoke passed with installed ${platformPack.name}.`);
  write(
    "types.ts",
    `
    import { test, testAsync, TestCase, Database, Verbosity, HealthCheck, generators, type Settings } from '@hegeldev/hegel';
    import * as gs from '@hegeldev/hegel/generators';
    const settings: Partial<Settings> = { database: Database.disabled, verbosity: Verbosity.Normal, suppressHealthCheck: [HealthCheck.FilterTooMuch] };
    test((tc: TestCase) => { const n: number = tc.draw(gs.integers()); const uuid: string = tc.draw(gs.uuids({version: 4})); void n; void uuid; tc.draw(generators.booleans()); }, settings);
    await testAsync(async tc => { tc.draw(gs.text()); }, settings);
  `,
  );
  write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        types: [],
        lib: ["ES2022", "DOM"],
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      files: ["types.ts"],
    }),
  );
  run(process.execPath, [
    path.join(ROOT, "node_modules/typescript/bin/tsc"),
    "-p",
    "tsconfig.json",
  ]);
  write(
    "app.js",
    `
    import * as h from '@hegeldev/hegel';
    import * as gs from '@hegeldev/hegel/generators';
    function check(ok, message) { if (!ok) throw new Error(message); }
    check(Object.keys(h).sort().join() === ${JSON.stringify(native.root.join())}, 'root exports');
    check(Object.keys(gs).sort().join() === ${JSON.stringify(native.generators.join())}, 'generator exports');
    for (const name of Object.keys(gs)) check(gs[name] === h.generators[name], 'generator identity');
    let sync = 0, asyncCount = 0;
    check(h.test(tc => {
      check(tc.draw(gs.integers({minValue: 7, maxValue: 7})) === 7, 'integer');
      check(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(tc.draw(gs.uuids({version: 4}))), 'uuid');
      sync++;
    }, {testCases: 3}) === undefined, 'sync signature');
    await h.testAsync(async tc => { await Promise.resolve(); check(typeof tc.draw(gs.booleans()) === 'boolean', 'boolean'); asyncCount++; }, {testCases: 3});
    let failure;
    try { h.test(tc => { const n = tc.draw(gs.integers({minValue: 0, maxValue: 100})); if (n >= 50) throw new Error('n=' + n); }, {seed: 42}); } catch (error) { failure = error.message; }
    check(failure === 'n=50' || failure?.startsWith('n=50 ['), 'shrink and final replay: ' + failure);
    let rejected = false;
    try { h.test(() => {}, {database: h.Database.fromPath('unsupported')}); } catch (error) { rejected = /database|filesystem|persist/i.test(error.message); }
    check(rejected, 'database rejection');
    check(sync > 0 && asyncCount > 0, 'test bodies ran');
    globalThis.hegelResult = {sync, asyncCount, failure, exports: Object.keys(h).sort()};
  `,
  );
  write("index.html", '<!doctype html><script type="module" src="./app.js"></script>');
  const configurations = {
    vite: async (out) => {
      const result = await viteBuild({
        root: temp,
        configFile: false,
        base: "/nested/",
        logLevel: "warn",
        build: {
          target: "es2022",
          outDir: out,
          minify: false,
          assetsInlineLimit: 0,
          rollupOptions: { input: path.join(temp, "index.html") },
        },
      });
      checkGraph(
        result.output.flatMap((output) =>
          output.type === "chunk" ? Object.keys(output.modules) : [],
        ),
      );
    },
    webpack: async (out) => {
      const stats = await new Promise((resolve, reject) => {
        const compiler = webpack({
          mode: "development",
          target: ["web", "es2022"],
          context: temp,
          entry: "./app.js",
          devtool: false,
          output: { path: out, filename: "app.js", publicPath: "/nested/", module: true },
          experiments: { outputModule: true },
          optimization: { minimize: false },
        });
        compiler.run((error, stats) =>
          compiler.close((closeError) =>
            error || closeError ? reject(error || closeError) : resolve(stats),
          ),
        );
      });
      assert(!stats.hasErrors(), stats.toString({ colors: false }));
      const modules = stats.toJson({ all: false, modules: true }).modules;
      checkGraph(modules.map((module) => module.name ?? ""));
    },
    esbuild: async (out) => {
      const result = await esbuild({
        absWorkingDir: temp,
        entryPoints: ["app.js"],
        bundle: true,
        platform: "browser",
        format: "esm",
        target: "es2022",
        outfile: path.join(out, "app.js"),
        metafile: true,
      });
      checkGraph(Object.keys(result.metafile.inputs));
      fs.copyFileSync(wasm, path.join(out, WASM_ASSET));
    },
    rollup: async (out) => {
      // Default node-resolve conditions intentionally exercise the package's default export.
      const bundle = await rollup({
        input: path.join(temp, "app.js"),
        plugins: [nodeResolve()],
      });
      try {
        const result = await bundle.write({ dir: out, format: "es", entryFileNames: "app.js" });
        checkGraph(
          result.output.flatMap((output) =>
            output.type === "chunk" ? Object.keys(output.modules) : [],
          ),
        );
      } finally {
        await bundle.close();
      }
      fs.copyFileSync(wasm, path.join(out, WASM_ASSET));
    },
  };
  browser = await chromium.launch({ headless: true });
  console.log(
    `Chromium ${browser.version()}; packed ${packed.filename}; Wasm ${sha256(wasmBytes)}`,
  );
  for (const [name, build] of Object.entries(configurations)) {
    const out = path.join(temp, name);
    fs.mkdirSync(out);
    await build(out);
    if (name !== "vite")
      fs.copyFileSync(path.join(temp, "index.html"), path.join(out, "index.html"));
    const emitted = files(out);
    assert(
      emitted.some((f) => f.endsWith(".wasm")),
      `${name} did not emit Wasm`,
    );
    for (const file of emitted.filter((f) => f.endsWith(".wasm"))) {
      verifyBytes(fs.readFileSync(file));
    }
    for (const file of emitted.filter((f) => f.endsWith(".js"))) {
      const code = fs.readFileSync(file, "utf8");
      const source = ts.createSourceFile(
        file,
        code,
        ts.ScriptTarget.ES2022,
        true,
        ts.ScriptKind.JS,
      );
      function visit(node) {
        if (ts.isIdentifier(node)) {
          assert(
            !["process", "Buffer", "koffi", "__vite_browser_external"].includes(node.text),
            `${name} output contains Node identifier ${node.text}`,
          );
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    const mimeTypes =
      name === "vite" ? ["application/wasm", "application/octet-stream"] : ["application/wasm"];
    for (const mime of mimeTypes) {
      const requests = [];
      const server = createServer((request, response) => {
        const url = new URL(request.url, "http://localhost");
        if (!url.pathname.startsWith("/nested/")) {
          response.writeHead(404).end();
          return;
        }
        const file = path.resolve(out, url.pathname.slice("/nested/".length) || "index.html");
        if (!file.startsWith(out + path.sep) || !fs.existsSync(file)) {
          response.writeHead(404).end();
          return;
        }
        requests.push(url.pathname);
        response.setHeader(
          "Content-Type",
          file.endsWith(".wasm") ? mime : file.endsWith(".js") ? "text/javascript" : "text/html",
        );
        response.end(fs.readFileSync(file));
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          globalThis.wasmCalls = { streaming: 0, bytes: 0 };
          const streaming = WebAssembly.instantiateStreaming;
          const instantiate = WebAssembly.instantiate;
          WebAssembly.instantiateStreaming = (...args) => {
            globalThis.wasmCalls.streaming++;
            return streaming(...args);
          };
          WebAssembly.instantiate = (...args) => {
            globalThis.wasmCalls.bytes++;
            return instantiate(...args);
          };
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/nested/`);
        await page.waitForFunction(() => globalThis.hegelResult, null, { timeout: 30000 });
        assert.deepEqual(errors, []);
        const result = await page.evaluate(() => ({
          result: globalThis.hegelResult,
          calls: globalThis.wasmCalls,
        }));
        assert.equal(result.calls.streaming, 1);
        assert.equal(result.calls.bytes, mime === "application/wasm" ? 0 : 1);
        assert.equal(requests.filter((r) => r.endsWith(".wasm")).length, 1);
        console.log(`${name} ${mime}: ${JSON.stringify(result)}`);
      } catch (error) {
        throw new Error(`${name} ${mime}: ${errors.join("; ")}`, { cause: error });
      } finally {
        await page.close();
        await new Promise((resolve) => server.close(resolve));
      }
    }
  }
} finally {
  await browser?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
