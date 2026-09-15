# Browser support

`@hegeldev/hegel` supports browsers with the Wasm artifact published in libhegel 0.38.1. Upstream [PR #478](https://github.com/hegeldev/hegel-rust/pull/478) is merged, and release preparation verifies the published asset before packaging it.

## Use the same imports

```ts
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

hegel.test((tc) => {
  const n = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
  if (n < 0) throw new Error("negative integer");
});

await hegel.testAsync(async (tc) => {
  const n = tc.draw(gs.integers());
  await Promise.resolve(n);
});
```

The browser entry fetches and compiles the packaged raw Rust engine during module loading with top-level await. No initialization call is needed. After the import completes, `test()` is synchronous and returns `void`; `testAsync()` returns `Promise<void>`.

Use modern ESM with an ES2022 build target, WebAssembly bigint integration, and Web Crypto in a secure context, normally HTTPS or localhost. Serve the `.wasm` file from a URL allowed by your fetch/CORS and Content Security Policy. CSP deployments may need `wasm-unsafe-eval`. Serve `application/wasm` for streaming compilation. The loader also handles an incorrect MIME type by instantiating the response bytes. Network, compile, link and runtime errors still escape.

Generation and shrinking run synchronously on the main browser thread. A long test can freeze the page, even when the property uses `testAsync()`. There are no workers or engine-output callbacks.

`Database.unset` and `Database.disabled` both disable browser persistence. Passing `Database.fromPath(...)` in browser test settings throws, including an empty path; constructing the database value does not. There is no IndexedDB, localStorage, filesystem or cloud database. Browser notes and final replay output use the console. Antithesis and concurrent state machines are not supported in browsers. Nondeterministic engine failures produce an explicit error rather than a false deterministic replay.

All generators use the same schema interpreter and Rust engine as Node, including canonical UUID strings from `uuids()` and version-restricted UUIDs from `uuids({ version: 4 })`. Temporal strings preserve nanoseconds, with nine fractional digits when nonzero. Rust text generation excludes surrogate codepoints; the adapter preserves WTF-8 where the engine returns it.

## Bundle the asset

Root export conditions are ordered `types`, `node`, `browser`, `default`. Node takes the native Koffi entry, even if `browser` is also enabled. The default is the browser entry so web tools without a browser condition cannot accidentally import Koffi. Do not add `node` to a browser bundler's conditions.

The entry contains the literal expression:

```js
new URL("./libhegel-wasm32-unknown-unknown.wasm", import.meta.url);
```

The asset is also exported as `@hegeldev/hegel/libhegel.wasm`. Koffi and native optional platform packages remain install-time dependencies of this single npm package, but they are absent from browser bundles. Node, Bun and Deno retain their native conditional-export path.

### Vite

Vite handles the static URL and emits the asset. Set the target and deployment base:

```js
export default {
  base: "/tests/",
  build: { target: "es2022", assetsInlineLimit: 0 },
};
```

### webpack

webpack 5 handles the URL as an asset. An ESM output configuration is:

```js
export default {
  target: ["web", "es2022"],
  experiments: { outputModule: true },
  output: { module: true, publicPath: "/tests/" },
};
```

### esbuild and Rollup

These configurations preserve the URL relative to the output module but do not copy the Wasm file. For a single output module, copy the exported asset beside that module under its original filename. This is build-time asset handling, not a runtime initialization API.

```js
import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Run after emitting out/app.js:
copyFileSync(
  require.resolve("@hegeldev/hegel/libhegel.wasm"),
  "out/libhegel-wasm32-unknown-unknown.wasm",
);
```

Use esbuild with `bundle: true`, `platform: "browser"`, `format: "esm"`, `target: "es2022"` and `outfile: "out/app.js"`.

Use Rollup with `@rollup/plugin-node-resolve` and `output: { format: "es", file: "out/app.js" }`. Default node-resolve conditions work because the package default is the browser entry. If your application splits chunks or changes directories, copy the asset beside the chunk containing Hegel's URL expression or configure an asset plugin to rewrite that URL. The tested copy recipe is for a single output module.

## Prepare published bytes explicitly

The pin lives in `src/browser/artifact.json`. It records engine version, exact source commit, Rust compiler commit, Cargo version, lockfile checksum, target, release tag, and artifact checksum.

Prepare the pinned release before building:

```sh
npm ci
npm run prepare:wasm -- release
export HEGEL_LIBHEGEL_PATH="$(node scripts/fetch-libhegel.mjs)"
npx playwright install chromium
npm run build
npm test
npm run test:packaging
npm run typecheck:portable
npm run test:browser
```

Preparation resolves the release tag to its commit, verifies that the commit is merged into upstream main, checks the Wasm asset and checksum sidecar, and stores the bytes with a provenance receipt under ignored `native/wasm/<sha256>/`.

The published SHA-256 is `1af8eb2a353b864fde9097fde8e22bf598e330aaf868573fe0c9a754076c9755`. The raw by-value temporal struct lowering is tied to this inspected artifact, not guaranteed by the C version string.

`npm run build` and `npm pack` verify the prepared artifact and receipt, then copy bytes to `dist/browser`. They do not download engine assets. Tests use the prepared Wasm by default; `HEGEL_WASM_PATH` can name another local copy only if its checksum matches. Library runtime fetches only the application-served packaged asset, never GitHub. Before this TypeScript package is released, native tests require the explicit native path above because the existing npm platform packages contain the older engine.

`npm run test:browser` packs and installs actual main and host-platform tarballs into a temporary consumer, using only the native and Wasm artifacts prepared by the preceding commands. It checks public declarations without Node types, runs native sync/async, UUID, shrinking, and database-persistence tests with no library-path override, then bundles the browser entry with Vite, webpack, esbuild and Rollup. Chromium runs every bundle under `/nested/` with the correct Wasm MIME type, and Vite also covers the incorrect-MIME fallback. Browser checks cover exports, sync/async calls, UUIDs, shrinking to 50, database rejection, emitted assets, request counts and dependency graphs. There are no source aliases, runtime GitHub downloads or browser polyfills. This matrix does not yet establish Firefox or Safari compatibility.

## Update to a future engine release

Audit the new source, type signatures, and temporal struct calls. Update the single JSON pin with the published checksum and source commit. Keep the toolchain and lockfile evidence accurate. The release source must equal the resolved tag commit and be an ancestor of upstream main.

`node scripts/update-libhegel.mjs <engine-version>` requires that reviewed Wasm pin first. It verifies the native asset set, checks the stable GitHub release and merged source, downloads the Wasm and checksum sidecar, compares the checksum to the pin, then updates the native version. Release preparation downloads published bytes; it does not rebuild a release. Rerun all native, Wasm, coverage, and packed-browser checks.

Release automation repeats explicit release preparation before changing package versions or publishing platform packages. Platform assembly requires release provenance. `prepublishOnly` rejects development pins and verifies that packaged bytes equal the prepared published artifact. npm's deliberate `--ignore-scripts` option can bypass lifecycle hooks; it is not a supported publication procedure.
