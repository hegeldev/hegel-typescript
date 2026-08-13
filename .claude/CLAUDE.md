# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`@hegeldev/hegel` — property-based testing for TypeScript. The client drives
**libhegel**, the native Rust engine (`hegel-rust/hegel-c`, version pinned in
`src/libhegel-version.ts`), directly through its C ABI via the `koffi` FFI library.
There is no subprocess and no wire protocol: the engine runs on a worker thread
inside libhegel, and the client calls C functions synchronously.

## Commands

```bash
npm install
just test    # fetch libhegel into native/, vitest with coverage (fails if < 100%)
just lint    # prettier --check + eslint + tsc --noEmit
just format  # prettier --write
just docs    # typedoc (treatWarningsAsErrors) + open
just check   # lint + docs + test — everything CI runs
```

- Single file: `npx vitest run tests/integers.test.ts`; by name:
  `npx vitest run -t "test name"`. Omit `--coverage` — the 100% threshold only
  holds for the full suite.
- Tests load the real native library. Run `just fetch-libhegel` once to
  download the host artifact into `native/`, or set `HEGEL_LIBHEGEL_PATH`
  (tests resolve via `tests/libPath.ts`).
- `just build-libhegel` builds libhegel from a sibling `../hegel-rust` checkout
  for work against an unreleased engine; export the printed path as
  `HEGEL_LIBHEGEL_PATH`.

## Native Library Distribution

Each platform's libhegel ships as its own npm package
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

`src/libhegel-version.ts` pins the libhegel release; `scripts/fetch-libhegel.mjs`
downloads that release's artifacts into `native/<version>/` (the versioned path
is the cache invalidation — a pin bump misses and re-downloads). Regenerate the
pin with `just update-libhegel` (it is generated code — never edit by hand).

## Architecture

Layers, each building on the previous:

1. **Library loading** (`src/locate.ts`, `src/libhegel-version.ts`) — resolve
   the shared library as described above.
2. **FFI binding** (`src/libhegel.ts`) — `koffi` bindings wrapped in a typed
   `Libhegel` class. Fallible calls return `hegel_result_t` codes that
   `Libhegel.check` maps to exceptions: `HEGEL_E_STOP_TEST` → `StopTestError`
   (choice budget exhausted; unwind and `mark_complete` with `OVERRUN`),
   `HEGEL_E_ASSUME` → `AssumeError` (engine rejected a draw; `mark_complete`
   with `INVALID`), any other non-OK code → `LibhegelError` carrying
   `hegel_context_last_error`. `mark_complete` is called exactly once per case.
3. **Schema interpreter** (`src/generate.ts`) — the ABI exposes one typed
   entry point per primitive draw (`hegel_generate_integer`,
   `hegel_generate_string`, …); this module walks the generators' schema IR
   and drives those calls, handling compound structure (`one_of`, `tuple`,
   `list`, `dict`, `constant`) client-side with the matching shrinker spans
   and the collection protocol. String-shaped draws go through cached
   `hegel_string_generator_t` handles (never freed by design).
4. **Session** (`src/session.ts`) — a process-global, lazily-loaded `Libhegel`
   handle with a `major.minor` version compatibility check. Users never
   construct it; `hegel.test()` / `hegel.testAsync()` are free functions.
5. **Test runner** (`src/runner.ts`) — drives `run_start` → `next_test_case` →
   `mark_complete` → `run_result`. The engine only explores (generate/shrink);
   the client owns the final replay: on `FAILED`, the runner replays each
   failure's `hegel_failure_reproduction_blob` via `hegel_test_case_from_blob`
   to surface the test's own error as the thrown message. `NativeDataSource`
   implements `DataSource` against a libhegel test case.
6. **Generators** (`src/generators/`) — transport-agnostic: they build plain
   schema records and draw through the `DataSource` interface. `composite`
   (imperative) and `record` (declarative) in `compose.ts` are the composition
   entry points.

The C ABI is declared in `hegel-rust/hegel-c/include/hegel.h`. koffi frees
nothing — every handle the ABI writes back is caller-owned: the runner frees
`Context`/`Settings`/`Run` handles, each test case from `next_test_case`, the
run result, each failure, and each collection explicitly in `finally` blocks.
Generated strings decode through `wtf8.ts` (UTF-8 exactly; safe if the engine
ever hands back a lone surrogate again).

### Synchronous FFI

All libhegel calls block — `hegel.test` is a synchronous function.
`hegel.testAsync` only awaits the user's async body between (synchronous)
draws.

## Testing Philosophy

- **100% coverage is mandatory** (vitest v8 thresholds plus
  `scripts/check-coverage.py`). No coverage-ignore comments: drive real error
  paths against the real library, and use an injected fake `Bindings` only for
  the few result-code/NULL branches the engine can't be driven into.
- **Never mock the engine.** Integration tests run against the real libhegel.
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
