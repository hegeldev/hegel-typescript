# Browser support

`@hegeldev/hegel` supports browsers through the WebAssembly build of libhegel that hegel-rust publishes with every release (since [PR #478](https://github.com/hegeldev/hegel-rust/pull/478)); the package ships the module of its pinned engine version.

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

All generators use the same schema interpreter and Rust engine as Node, including canonical UUID strings from `uuids()` and version-restricted UUIDs from `uuids({ version: 4 })`. Temporal strings preserve nanoseconds (six fractional digits for whole microseconds, nine otherwise). Rust text generation excludes surrogate codepoints; the adapter preserves WTF-8 where the engine returns it.

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

## Maintainers: the Wasm module is one more asset of the pinned release

The browser entry runs the same libhegel release as the native library. `src/libhegel-version.ts` is the only pin; hegel-rust publishes `libhegel-wasm32-unknown-unknown.wasm` (with a `.sha256` sidecar) next to the native libraries on the `libhegel-v<version>` release. `just fetch-libhegel` downloads the host library and the Wasm module into `native/<version>/`, verifying each against its sidecar; the tests load the module from there (or from `HEGEL_WASM_PATH`, the counterpart of `HEGEL_LIBHEGEL_PATH`), and `npm run build` fetches it if needed and copies it into `dist/browser/`, where the browser entry's `new URL(...)` expression finds it. The library never downloads anything at runtime; it fetches only the asset the application serves.

To run everything locally:

```sh
npm ci
export HEGEL_LIBHEGEL_PATH="$(just fetch-libhegel)"
(cd tests/browser && npm ci && npx playwright install chromium)
npm run build
npm test
npm run test:packaging
npm run typecheck:portable
npm run test:browser
```

`npm run test:browser` (`tests/browser/run.mjs`; the bundlers and Playwright are that fixture's own dependencies, not the library's) packs and installs the actual main and host-platform tarballs into a temporary consumer. It checks the public declarations without Node types, runs native sync/async, UUID, shrinking and database-persistence tests with no library-path override, then bundles the browser entry with Vite, webpack, esbuild and Rollup. Chromium runs every bundle under `/nested/` with the correct Wasm MIME type, and Vite also covers the incorrect-MIME fallback. Browser checks cover exports, sync/async calls, UUIDs, shrinking to 50, database rejection, emitted assets (byte-identical to the fetched module), request counts and dependency graphs (no Koffi, Node built-ins or polyfills). This matrix does not yet establish Firefox or Safari compatibility.

When bumping the engine (`just update-libhegel`, which is also what the automated bump runs), the release must publish the Wasm module and its sidecar, and `src/browser/abi.ts` must be audited against the new `hegel.h`: every raw Wasm signature (in particular the by-value temporal structs, which lower to pointers) must still match the module. At startup the loader checks the module's version string against the pin, nothing more.
