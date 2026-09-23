# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`@hegeldev/hegel` — property-based testing for TypeScript. The client drives
**libhegel**, the Rust engine (`hegel-rust/hegel-c`, version pinned in
`src/libhegel-version.ts`), directly through its C ABI. On Node, Bun and Deno
that is the native shared library via the `koffi` FFI library; in browsers it
is the same engine compiled to `wasm32-unknown-unknown`, driven through the raw
Wasm exports. There is no subprocess and no wire protocol: the engine runs
inside libhegel, and the client calls its functions synchronously. Both
runtimes share one runner, one schema interpreter and one public API.

## Commands

```bash
npm install
just test    # fetch libhegel into native/, vitest with coverage (fails if < 100%)
just lint    # prettier --check + eslint + tsc --noEmit + typecheck:portable
just format  # prettier --write
just docs    # typedoc (treatWarningsAsErrors) + open
just check   # lint + docs + test — everything CI runs on the main matrix

npm run test:packaging  # node --test scripts/packaging.test.mjs (export map, sidecars, update-libhegel)
npm run test:browser    # pack the package, bundle it four ways, run in Chromium (see below)
```

- Single file: `npx vitest run tests/integers.test.ts`; by name:
  `npx vitest run -t "test name"`. Omit `--coverage` — the 100% threshold only
  holds for the full suite.
- Tests load the real engine, native and Wasm. Run `just fetch-libhegel` once
  to download both into `native/<version>/`, or set `HEGEL_LIBHEGEL_PATH`
  (resolved by `tests/libPath.ts`) and `HEGEL_WASM_PATH` (resolved by
  `tests/wasmFixture.ts`).
- `just build-libhegel` builds libhegel from a sibling `../hegel-rust` checkout
  for work against an unreleased engine; export the printed path as
  `HEGEL_LIBHEGEL_PATH`. For the Wasm side, build there with
  `cargo build -p hegeltest-c --release --target wasm32-unknown-unknown` and
  export the module's path as `HEGEL_WASM_PATH`.
- `npm run test:browser` needs the fixture in `tests/browser/` installed first:
  `(cd tests/browser && npm ci && npx playwright install chromium)`. The
  bundlers and Playwright are devDependencies of that fixture, not of the
  library.

## Engine Distribution

Each platform's native libhegel ships as its own npm package
(`@hegeldev/hegel-<os>-<arch>`), exact-pinned in `optionalDependencies`; the
`os`/`cpu` fields in each manifest make package managers install only the
host's package. `scripts/make-platform-packages.mjs` assembles them into
`platform-packages/`, and the release pipeline publishes all five before the
main package.

Runtime resolution (`src/locate.ts`, synchronous by necessity):
`HEGEL_LIBHEGEL_PATH` → the platform package's `./binary` export. There is no
`native/` step in production code: the repo's own test runs point
`HEGEL_LIBHEGEL_PATH` at the pinned engine (`just check-test` wires this up
from `fetch-libhegel`'s output).

The Wasm module (`libhegel-wasm32-unknown-unknown.wasm`) ships inside the main
package at `dist/browser/`, next to the browser entry: `npm run build` is
`tsc && node scripts/fetch-libhegel.mjs --wasm dist/browser`, and `prepack`
runs it. `src/browser/index.ts` loads it with a static
`new URL("./libhegel-wasm32-unknown-unknown.wasm", import.meta.url)` so Vite
and webpack emit it as an asset; esbuild and Rollup users copy the
`./libhegel.wasm` export beside their bundle (`BROWSER.md` documents this).
The root export map is ordered `types` → `node` → `browser` → `default`, so
Node wins whenever it is enabled and browser-oriented tools cannot fall back to
the koffi entry; `scripts/packaging.test.mjs` pins that ordering.

`src/libhegel-version.ts` is the single pin for both artifacts.
`scripts/fetch-libhegel.mjs` downloads the pinned release's host library and
Wasm module into `native/<version>/`, verifying each against the release's
`.sha256` sidecar (the versioned path is the cache invalidation — a pin bump
misses and re-downloads). Regenerate the pin with `just update-libhegel`; it
refuses a release that does not publish every platform asset, the Wasm module
and their sidecars. The pin file is generated code — never edit by hand. After
a bump, follow the `align-libhegel` skill: the koffi bindings _and_ the raw
Wasm signature table in `src/browser/abi.ts` must be audited against `hegel.h`.

## Architecture

Layers, each building on the previous. Everything above the engine adapters is
shared by Node and the browser; `tsconfig.portable.json` type-checks exactly
that shared set plus `src/browser/` against `ES2022 + DOM` with no Node types,
so a Node import creeping into a shared module fails `just lint`.

1. **Engine interface** (`src/engine.ts`) — `Engine` is the runtime-independent
   view of the C ABI: one method per ABI operation, opaque branded handle types
   (`ContextHandle`, `TestCaseHandle`, …) so pointers from different adapters
   cannot be mixed, the `Status`/`RunStatus`/`NativeVerbosity` enums copied
   from `hegel.h`, and `EngineError` for adapter faults that must never reach
   the shrinker.
2. **Native adapter** (`src/locate.ts`, `src/libhegel.ts`, `src/session.ts`) —
   `locate.ts` resolves the shared library as described above; `Libhegel`
   wraps `koffi` bindings and implements `Engine`. Fallible calls return
   `hegel_result_t` codes that `Libhegel.check` maps to exceptions:
   `HEGEL_E_STOP_TEST` → `StopTestError` (choice budget exhausted; unwind and
   `mark_complete` with `OVERRUN`), `HEGEL_E_ASSUME` → `AssumeError` (engine
   rejected a draw; `mark_complete` with `INVALID`), any other non-OK code →
   `LibhegelError` carrying `hegel_context_last_error`. `session.ts` holds the
   process-global, lazily-loaded `Libhegel` with a `major.minor` version check.
3. **Wasm adapter** (`src/browser/`) — `abi.ts` is the table of raw exported
   function signatures (checked at instantiation, so a drifted module fails
   loudly), `arena.ts` provides bounds-checked memory views and
   `WasmArena.scoped` for temporary allocations released after each call,
   `host.ts` supplies the two `hegel_host` imports (`entropy_fill` from Web
   Crypto, `monotonic_nanos` from `performance.now()`), `engine.ts` implements
   `Engine` over those (copying engine-owned bytes and strings out before the
   matching destructor runs), and `load-wasm.ts` compiles/instantiates from a
   URL, `Response`, `ArrayBuffer` or `Module` (streaming when the MIME type
   allows, byte fallback otherwise) and checks the engine's version string
   against the pin in `artifact.ts`.
4. **Schema interpreter** (`src/generate.ts`) — the ABI exposes one typed
   entry point per primitive draw (`hegel_generate_integer`,
   `hegel_generate_string`, …); this module walks the generators' schema IR
   and drives those calls through `Engine`, handling compound structure
   (`one_of`, `tuple`, `list`, `dict`, `constant`) client-side with the
   matching shrinker spans and the collection protocol. String-shaped draws go
   through a per-engine `StringGeneratorCache` of `hegel_string_generator_t`
   handles, bounded and freed with the runner.
5. **Runtime services** (`src/runtime.ts`, `src/nodeRuntime.ts`,
   `src/browser/runtime.ts`) — `RuntimeServices` is the small set of
   host-specific things the shared loop needs: how to get the `Engine`,
   default settings (CI detection is Node-only), settings validation (the
   browser rejects `Database.fromPath`), diagnostics output, and Antithesis
   assertion emission (Node-only).
6. **Shared runner** (`src/runnerCore.ts`) — the sync and async run loops:
   `run_start` → `next_test_case` → `mark_complete` → `run_result`. The engine
   only explores (generate/shrink); the client owns the final replay: on
   `FAILED`, the runner replays each failure's `hegel_failure_reproduction_blob`
   via `hegel_test_case_from_blob` to surface the test's own error as the
   thrown message. `EngineDataSource` implements `DataSource` against an
   engine test case. `createRunner(runtime)` produces `test`/`testAsync`.
7. **Composition roots** (`src/runner.ts` + `src/index.ts` for Node,
   `src/browser/index.ts` for browsers) — each builds one runner from its
   `RuntimeServices` and re-exports the same public surface. The browser entry
   loads the Wasm module with top-level `await`, so consumers need ES2022 ESM
   tooling; there is no separate init API.
8. **Generators** (`src/generators/`) — transport-agnostic: they build plain
   schema records and draw through the `DataSource` interface. `composite`
   (imperative) and `record` (declarative) in `compose.ts` are the composition
   entry points.

The C ABI is declared in `hegel-rust/hegel-c/include/hegel.h`. Neither adapter
frees anything implicitly — every handle the ABI writes back is caller-owned:
the runner frees `Context`/`Settings`/`Run` handles, each test case from
`next_test_case`, the run result, each failure, and each collection explicitly
in `finally` blocks, in ownership order. Generated strings decode through
`wtf8.ts` (UTF-8 exactly; safe if the engine ever hands back a lone surrogate
again).

### Synchronous engine calls

All libhegel calls block — `hegel.test` is a synchronous function.
`hegel.testAsync` only awaits the user's async body between (synchronous)
draws. In the browser this means generation and shrinking run on the calling
thread (the main thread unless the user runs tests in a worker themselves).

### Browser non-goals (for now)

No persistence (`Database.fromPath` throws; `unset` becomes `disabled`), no
worker offloading, no Antithesis output, no raw engine-output callbacks. Web
Crypto in a secure context is required, and the Wasm asset must be servable
under the page's CORS/CSP.

## Testing Philosophy

- **100% coverage is mandatory** (vitest v8 thresholds plus
  `scripts/check-coverage.py`). No coverage-ignore comments: drive real error
  paths against the real library, and use an injected fake `Bindings` (native)
  or fake Wasm exports / `tests/fakeEngine.ts` (Wasm and shared runner) only
  for the few result-code/NULL/corrupt-output branches the engine can't be
  driven into.
- **Never mock the engine.** Integration tests run against the real libhegel,
  both the native library (`tests/libPath.ts`) and the real Wasm module
  instantiated in Node (`tests/wasmFixture.ts`); `tests/wasm-*.test.ts` and
  `tests/browser-index.test.ts` cover the Wasm adapter and loader.
- `npm run test:browser` (`tests/browser/run.mjs`) is the end-to-end check for
  packaging: it packs the real tarballs, installs them without source aliases,
  verifies native execution and portable declarations, bundles a consumer with
  Vite, webpack, esbuild and Rollup, and runs each bundle in Chromium (Vite
  also exercises the wrong-MIME fallback). It also asserts that browser bundles
  contain no koffi, Node built-ins, `Buffer` or native binaries.
- Vitest ESM note: `vi.spyOn(fs, ...)` throws on frozen ESM namespaces — use a
  hoisted `vi.mock("node:fs", ...)` factory and `vi.mocked(...)` instead.

## Releasing / Changelog

**Never edit `CHANGELOG.md` by hand.** Every PR that modifies `src/` must
include a `RELEASE.md` at the repo root (`check-release` CI enforces this).
After merge, `.github/scripts/release.py` bumps `package.json` (including the
platform-package pins), publishes the five platform packages, and prepends
`RELEASE.md` to the changelog. Format: a `RELEASE_TYPE: patch` line, blank
line, then the changelog text. While on 0.x: breaking changes are `minor`,
everything else is `patch`. `RELEASE-sample.md` is the worked example and the
`changelog` skill is the style guide.

## Conventions

- ESM with `"module": "Node16"`: imports need `.js` extensions, and type
  re-exports need `export type { Foo }`.
- Prettier config lives in `package.json` (`"prettier"` key); there is no
  `.prettierrc`.
- TypeDoc runs with `treatWarningsAsErrors` — a `{@link Foo}` to a
  non-exported symbol fails `just docs`. Export it or drop the link.
- Node >= 20.11 required (koffi's loader needs `import.meta.dirname`).
- `tests/browser/` (with its own lockfile) and `tests/smoke/` are separate npm
  packages; keep tooling that only they need out of the root `package.json`.
