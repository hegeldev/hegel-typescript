# Hegel for TypeScript

## Build Commands

```bash
just setup   # Install dependencies and hegel binary
just test    # Run tests with coverage (fails if coverage < 100%)
just format  # Auto-format code
just lint    # Check formatting + linting
just docs    # Build API documentation
just check   # Run lint + docs + test (full CI check)
```

Tests must use `PATH=".venv/bin:$PATH"` so the `hegel` binary is found.

## What This Is

A TypeScript implementation of the Hegel property-based testing library. Hegel is a
universal property-based testing protocol powered by Hypothesis on the backend.
Client libraries communicate with the `hegel` binary (a Python server) via Unix sockets using
a custom binary protocol.

## Architecture

The library is structured in layers, each building on the previous:

1. **Protocol Layer** — Binary wire protocol with 20-byte header, CBOR payload, CRC32
2. **Connection & Streams** — Unix socket multiplexing with demand-driven reader
3. **Test Runner** — Spawns `hegel` subprocess, manages test lifecycle
4. **Generators** — Type-safe generator abstraction, span system, collection protocol
5. **Derivation** — Type-directed generator derivation via decorators, record schemas, and variant generators
6. **Conformance** — Test binaries that validate library correctness against the framework

### Key Pattern: Demand-Driven Reader

The Connection uses a demand-driven model: when a Stream needs a message, it
acquires a reader lock and reads packets from the socket until its inbox has data.
No background threads — reading is triggered by the consumer that needs data.

### Key Pattern: Thread-Local Stream State

The current data stream is stored in thread-local (or context-var) state so that
generator functions (`generate()`, `assume()`, `note()`, `target()`) don't need a
stream parameter. The test runner sets the current stream before calling the test
body.

### Key Pattern: Global Lazy Session

The `hegel` subprocess is managed by a global session that starts lazily on first
use and shuts down automatically on process exit. Users never construct connections
or sessions manually — `run_hegel_test()` is a plain free function.

## Testing Philosophy

- **100% code coverage** is mandatory. `just check` fails if any line is uncovered.
  Use `HEGEL_PROTOCOL_TEST_MODE` (see below) to cover error paths — do NOT use `# nocov`.
- **Use the real `hegel` binary** for integration tests. Never write a mock server.
  The real binary runs as a subprocess, so there is zero threading contention.
  In-process mocks with threads cause deadlocks — they have wasted hundreds of
  agent turns in previous library generations.
- **Socket pairs** (`socketpair()`) for unit testing Connection/Stream in isolation.

### HEGEL_PROTOCOL_TEST_MODE — Error Injection

Set the `HEGEL_PROTOCOL_TEST_MODE` environment variable before calling `run_hegel_test` to
trigger server-side error injection:

| Mode                           | What it does                              |
| ------------------------------ | ----------------------------------------- |
| `stop_test_on_generate`        | StopTest on 1st generate of 2nd test case |
| `stop_test_on_mark_complete`   | StopTest in response to mark_complete     |
| `stop_test_on_collection_more` | StopTest during collection_more           |
| `stop_test_on_new_collection`  | StopTest during new_collection            |
| `error_response`               | RequestError on first generate            |
| `empty_test`                   | test_done immediately, no test cases run  |

## Type-Directed Generator Derivation

The library supports automatic generator derivation for TypeScript classes and
plain-object types. Three mechanisms are available:

### 1. Class-based derivation with `@field` decorator

```typescript
import { field, deriveGenerator, integers, text, booleans } from "hegel";

class User {
  @field(text({ minSize: 1, maxSize: 50 }))
  name!: string;

  @field(integers({ minValue: 18, maxValue: 120 }))
  age!: number;

  @field(booleans())
  active!: boolean;
}

const userGen = deriveGenerator(User);
// userGen.generate() returns a User instance with random fields
```

Requires `"experimentalDecorators": true` in `tsconfig.json`.

### 2. Plain-object records with `recordGenerator`

```typescript
import { recordGenerator, floats } from "hegel";

const pointGen = recordGenerator({
  x: floats({ minValue: -100, maxValue: 100 }),
  y: floats({ minValue: -100, maxValue: 100 }),
});
// pointGen.generate() returns { x: number, y: number }
```

### 3. Discriminated unions with `variantGenerator`

```typescript
import { variantGenerator, recordGenerator, floats } from "hegel";

type Shape =
  | { type: "circle"; radius: number }
  | { type: "rectangle"; width: number; height: number }
  | { type: "point" };

const shapeGen = variantGenerator<Shape>({
  circle: recordGenerator({ radius: floats({ minValue: 0.1, maxValue: 100 }) }),
  rectangle: recordGenerator({
    width: floats({ minValue: 0.1, maxValue: 100 }),
    height: floats({ minValue: 0.1, maxValue: 100 }),
  }),
  point: null, // data-less variant
});
// shapeGen.generate() returns one of the Shape variants at random
```

All derived generators support `.map()`, `.filter()`, and `.flatMap()` combinators.

## Critical: StopTest Handling

When the server sends StopTest, the client MUST:

1. Raise a language-specific exception (DataExhausted/StopTest) to unwind the test body
2. NOT send `mark_complete` after receiving StopTest
3. Track a per-test-case `test_aborted` flag to suppress further commands

Failing to handle StopTest correctly causes `FlakyStrategyDefinition` errors.

## Wire Protocol

- **Header**: 5 big-endian uint32: `magic(0x4845474C)`, `CRC32`, `stream_id`,
  `message_id`, `payload_length`
- **Payload**: CBOR-encoded bytes
- **Terminator**: single byte `0x0A`
- **Reply bit**: `message_id | (1 << 31)` marks a message as a reply
- **Client stream IDs**: odd — allocated as `(counter << 1) | 1`
- **CRC32**: computed over the full 20-byte header (checksum field zeroed) + payload

## Tooling Choices

| Tool           | Package                        | Version         | Purpose                                                |
| -------------- | ------------------------------ | --------------- | ------------------------------------------------------ |
| TypeScript     | `typescript`                   | 5.9.3           | Type checking (`tsc --noEmit`), declaration generation |
| Test Framework | `vitest`                       | 4.0.18          | Test runner, native TypeScript/ESM support             |
| Coverage       | `@vitest/coverage-v8`          | 4.0.18          | V8-based code coverage, enforces 100% thresholds       |
| Linter         | `eslint` + `typescript-eslint` | 10.0.2 / 8.56.1 | Type-aware linting with ESLint v10 flat config         |
| Formatter      | `prettier`                     | 3.8.1           | Code formatting                                        |
| Documentation  | `typedoc`                      | 0.28.17         | API docs from TSDoc comments                           |
| Runtime        | Node.js                        | 22.x            | LTS runtime                                            |

### Build Commands Detail

- `just test` — `npx vitest run --coverage` then `python3 scripts/check-coverage.py`
- `just lint` — `npx prettier --check . && npx eslint . && npx tsc --noEmit`
- `just format` — `npx prettier --write .`
- `just docs` — `npx typedoc` (with `treatWarningsAsErrors: true`)

## Project Conventions

### File Layout

```
src/                 — Library source code (all production code)
  index.ts           — Public API entry point
  protocol.ts        — Binary wire protocol (header, CBOR, CRC32)
  connection.ts      — Unix socket connection and stream multiplexing
  runner.ts          — Test runner (Client, AsyncLocalStorage context, error classes)
  session.ts         — Global lazy session (HegelSession, runHegelTest, hegel)
  generators.ts      — Generator base class, combinators, all built-in generators
  derive.ts          — Type-directed derivation (@field, deriveGenerator, recordGenerator, variantGenerator)
tests/               — Test files (excluded from coverage)
  *.test.ts          — Vitest test files (one per module)
  showcase.test.ts   — Property tests demonstrating real library usage
  conformance/       — Python-side conformance test runner
conformance/         — TypeScript conformance test scripts (run as binaries via tsx)
  helpers.ts         — Shared helpers (getTestCases, writeMetrics, makeNonBasic)
  test_*.ts          — Individual conformance scenarios
scripts/             — Build/CI scripts
  check-coverage.py  — Secondary coverage validation script
README.md            — Project overview and quick start
dist/                — Compiled output (gitignored)
guide/               — User-facing tutorials (getting-started.md)
docs/                — Generated TypeDoc output (gitignored)
coverage/            — Coverage reports (gitignored)
```

### Naming Conventions

- Files: `kebab-case.ts` for source files, `kebab-case.test.ts` for tests
- Exports: `camelCase` for functions, `PascalCase` for classes/types/interfaces
- Constants: `UPPER_SNAKE_CASE`
- Private fields: prefix with `_` or use `#` private class fields

### Module System

- ESM (`"type": "module"` in package.json)
- Import with `.js` extension (required for Node16 module resolution)
- `tsconfig.json` uses `"module": "Node16"` and `"moduleResolution": "Node16"`

### Configuration Files

- `tsconfig.json` — TypeScript compiler options (strict mode enabled)
- `vitest.config.ts` — Test and coverage configuration
- `eslint.config.mjs` — ESLint flat config with typescript-eslint
- `.prettierrc` — Prettier formatting rules
- `typedoc.json` — TypeDoc documentation options

## Lessons Learned

- Vitest v4 with `@vitest/coverage-v8` provides built-in coverage thresholds that
  fail the test run if any metric drops below 100% — no external script needed for
  basic threshold enforcement. The `scripts/check-coverage.py` script is a secondary
  check that parses the JSON summary for more detailed reporting.
- ESLint v10 uses flat config exclusively (`eslint.config.mjs`). The `.eslintrc`
  format is no longer supported.
- TypeScript `"module": "Node16"` requires `.js` extensions in imports even though
  source files are `.ts`. This is the correct behavior for ESM Node.js projects.
- `"type": "module"` in package.json makes all `.js` files ESM by default. Use
  `.cjs` extension for any CommonJS files (like config files if needed).
- Add `@types/node` to devDependencies and `"types": ["node"]` in `tsconfig.json`
  to get types for `Buffer`, `net`, `zlib`, `module`, etc. Without this, TypeScript
  cannot find Node built-in types even with `@types/node` installed.
- **CRITICAL: JavaScript `<<` operator is 32-bit signed.** `(1 << 31)` equals
  `-2147483648`, not `2147483648`. Therefore `(1 << 31) - 1 = -2147483649`, not
  `2147483647`. Always use `2**31 - 1` or `0x7FFFFFFF` for the max non-reply message
  ID. Using `(1 << 31) - 1` causes `writeUInt32BE` to throw an out-of-range error.
- **Use readable (non-flowing) mode for sequential socket reads.** Multiple sequential
  `recvExact` calls with pause/resume (flowing mode) have a race condition: the `end`
  event can fire between calls while the socket is paused, causing `PartialPacketError`
  even though all data arrived. Switching to `readable` event + `socket.read()` (pull
  mode) eliminates this — data stays buffered and `socket.read()` returns it
  synchronously on the next call even after `end` fires.
- **`cbor-x` is the best CBOR library for TypeScript.** It is RFC 8949 compliant,
  ultra-fast, and ESM-friendly. Import as `import { encode, decode } from "cbor-x"`.
- **Re-exporting TypeScript interfaces with `isolatedModules: true`** requires
  `export type { Foo }` syntax. Plain `export { Foo }` causes a TS1205 error for
  interface/type re-exports.
- **CRC32 via Node built-in zlib.** `zlib.crc32(buf)` already returns an unsigned
  32-bit integer, so no `>>> 0` coercion is needed before `writeUInt32BE`. The `>>> 0`
  idiom is only required after bitwise operators (`|`, `&`, `^`, `<<`), which JavaScript
  evaluates as signed 32-bit. Import via `createRequire(import.meta.url)` in ESM context:
  `const zlib = require("zlib")`.
- **REPLY_BIT arithmetic.** `messageId | REPLY_BIT` can produce a negative JS integer
  because `<<` and `|` operate on signed 32-bit integers. Always apply `>>> 0` after
  the bitwise OR to convert to unsigned: `(messageId | REPLY_BIT) >>> 0`.
- **Demand-driven reader pattern.** Use `socket.setTimeout(ms)` + `SocketIdleTimeoutError`
  to periodically wake the reader loop and re-check `until()` without background threads.
  The `until()` predicate must be reachable from inside the reader loop — use a `satisfied`
  flag set by the consumer (not the ready-check itself) so `runReader` can exit promptly.
- **TCP coalesces writes.** In tests, even with delayed writes (`setTimeout`), data often
  arrives as a single chunk. To test partial-read paths, intercept `socket.read()` and
  control how many bytes are returned per call: read all available bytes with `origRead()`,
  split them, stash the second half, and return null on the loop's second call so `tryRead()`
  exits mid-packet. Then emit the event (timeout, etc.) before re-emitting `readable`.
- **ESLint flat config global ignores.** In ESLint v10 flat config, place `ignores` as a
  standalone first entry (`{ ignores: [...] }`) rather than inside the rule config object.
  Only top-level ignores entries apply globally across all files.
- **ESLint argsIgnorePattern for `_`-prefixed parameters.** Add `{ argsIgnorePattern: "^_",
varsIgnorePattern: "^_" }` to `@typescript-eslint/no-unused-vars` rule options so that
  intentionally unused parameters named `_` or `_foo` are not flagged as errors.
- **TypeDoc warns on unexported symbols referenced in JSDoc.** If `{@link Foo}` or
  `@throws {Foo}` appears in JSDoc but `Foo` is not in the public API, TypeDoc emits a
  warning that fails the docs build. Either export the symbol from `index.ts` or remove
  the reference from the JSDoc comment.
- **Hegel protocol field name is `stream_id`, not `stream`.** The `run_test` command
  must use `stream_id: testStream.streamId`, and `test_case` events send `stream_id`.
  Using the wrong key causes the server to never find the test stream and the connection
  to time out silently.
- **ESM module mocking in Vitest: `vi.spyOn` fails on frozen namespaces.** In Vitest ESM
  mode, `vi.spyOn(fs, "existsSync")` throws "Cannot assign to read only property" because
  ESM namespace objects are frozen. Use `vi.mock("node:fs", async (importOriginal) => {...})`
  at the top of the test file (hoisted before imports) and `vi.mocked(fs.existsSync)` to
  configure per-test behavior. The factory wraps each function in `vi.fn()`.
- **`AsyncLocalStorage` context: `undefined` vs `null`.** `getStore()` returns `undefined`
  when `run()` was never called (completely outside the context), `null` when `run(ctx, ...)`
  was called with `null`, and the context object inside a `run()` call. Distinguish all three
  states to correctly detect "not in test context" vs "in test infrastructure but no test case".
- **`process.on("exit", this._cleanupSync.bind(this))` instead of arrow wrapper.** Using
  `this._cleanupSync.bind(this)` avoids creating an anonymous arrow function that would
  be counted as an uncovered function by v8 coverage (since process exit never fires in tests).
- **Avoid fire-and-forget before `stream.close()`.** In `_runTestCase`'s finally block,
  `stream.sendRequest({command: "mark_complete"})` is fire-and-forget with `.catch(() => {})`.
  The underlying socket write is queued synchronously, so `stream.close()` immediately after
  is safe. But in test code overriding `_runTestCase`, always `await sendRequest(...)` before
  `close()` to ensure the packet is queued before the stream is destroyed.
- **Unhandled rejection warning from pending promise before handler attached.** When calling
  `session._start()` in a test and the promise will reject asynchronously (after fake timers
  advance), attach the rejection handler BEFORE advancing time: `const p = session._start();
const check = expect(p).rejects.toThrow(...); await advanceTimers(); await check;`. Without
  attaching a handler first, Node/Vitest fires "unhandled rejection" before the `expect` line runs.
- **v8 branch coverage tracks `??` operator branches individually.** `expr ?? defaultValue`
  generates two branches: one where `expr` is non-null/undefined (use `expr`) and one where
  it is null/undefined (use `defaultValue`). Defensive `?? fallback` patterns that are never
  hit in practice must be either tested or removed to achieve 100% branch coverage.
- **`extractOrigin` should prefer the first non-`node_modules` frame.** When parsing error
  stack traces, skip frames from `node_modules` (vitest internals) and use the first
  user-code frame. The fallback is the last parseable frame (for when all frames are internal).
- **`error_response` test mode does NOT throw.** The `error_response` HEGEL_PROTOCOL_TEST_MODE
  makes the server send a `RequestError` on the first `generate`, but the test body catches it
  and marks the case INTERESTING. The server then sends `test_done` with `interesting_test_cases=0`,
  so the overall test "passes". Tests expecting this mode to throw will fail — just verify it
  resolves.
- **v8 coverage counts anonymous arrow functions passed to APIs.** `process.on("exit", () => fn())`
  creates an anonymous function that v8 tracks separately. If that arrow is never invoked (process
  never exits), coverage drops below 100%. Use `.bind()` to pass the method directly, or expose
  the cleanup method for direct testing.
- **Concurrent `_start()` dedup via `_startPromise`.** Store the in-flight promise in `_startPromise`
  so concurrent callers await the same promise. Attach `.catch(() => {})` to `_startPromise` immediately
  after assignment to prevent Node's "unhandledRejection" warning if the promise rejects before
  the `await` catches it. The `.catch` creates a new handled promise without affecting the original.
- **Type-directed derivation in TypeScript uses legacy decorators.** TypeScript erases interfaces
  and type aliases at compile time, so there's no runtime reflection on type shapes. However,
  classes persist at runtime, so the `@field(generator)` decorator (with `experimentalDecorators:
true` in `tsconfig.json`) stores metadata in a `Map<Constructor, FieldMeta[]>`. The
  `deriveGenerator(MyClass)` function reads this metadata and builds a composite generator.
  For plain-object types (no class needed), `recordGenerator({...})` takes a schema mapping
  field names to generators. For sum types, `variantGenerator({...})` takes a mapping from
  tag names to field generators. All three use FIXED_DICT (label 10) or ENUM_VARIANT (label 15)
  spans for proper shrinking.
- **ESLint forbids the `Function` type.** The `@typescript-eslint/no-unsafe-function-type` rule
  rejects `Map<Function, ...>`. Use a type alias like `type AnyConstructor = new (...args: any[]) => any`
  with an eslint-disable comment for `@typescript-eslint/no-explicit-any` on that line.
- **Legacy decorator `PropertyDecorator` signature.** The `target` parameter is the class
  prototype (an `object`), and `propertyKey` is `string | symbol`. Access `target.constructor`
  to get the class constructor for metadata storage.
- **Conformance binaries use `tsx` for TypeScript-native execution.** Add `tsx` to devDependencies
  and use `node --import tsx/esm script.ts` in wrapper shell scripts. The `build-conformance`
  justfile recipe generates shell wrapper scripts in `bin/conformance/` that call tsx with the
  absolute path to the conformance TypeScript source file.
- **Justfile heredocs with `--` flags cause parse errors.** The justfile parser tries to parse
  heredoc contents and trips on `--import`. Use `printf` or `echo` with escaped characters
  instead: `printf '#!/usr/bin/env bash\n...' > file`.
- **`CompositeListGenerator` must create a fresh `Collection` per `generate()` call.** The
  `Collection` object tracks `_finished = true` after `more()` returns false. If the generator
  is shared across test cases (defined outside the test body), a single `Collection` instance
  would stay finished after the first test case, generating only empty lists for all subsequent
  ones. Fix: create `new Collection(...)` inside `generate()`, not in the constructor.
- **`JSON.stringify` does NOT escape U+0085 (NEL), U+2028, U+2029.** Python's `str.splitlines()`
  splits on U+0085 (NEXT LINE), U+2028 (LINE SEPARATOR), and U+2029 (PARAGRAPH SEPARATOR).
  All three can appear in text strings generated by the hegel server. When writing JSONL metrics
  that will be read by Python, explicitly replace these characters: `.replace(/\u0085/g, "\\u0085")`
  etc. Regular control characters (\x00-\x1F) ARE escaped by JSON.stringify, but these three are not.
- **Use `CompositeListGenerator` (collection protocol) for `stop_test_on_collection_more` and
  `stop_test_on_new_collection` conformance tests.** The `BasicGenerator` list schema path does
  NOT exercise the collection protocol on the client side — the server handles `collection_more`
  internally and returns StopTest as a `generate` response. This causes the server to close the
  connection after StopTest, triggering `Error: Connection closed` in the main test loop. Using
  `lists(integers().filter(() => true), ...)` forces `CompositeListGenerator` which calls
  `new_collection` and `collection_more` explicitly, allowing the server to send StopTest in the
  collection commands and then send `test_done` normally.
- **Float exclude_min/exclude_max must only be set when bounds exist.** The hegel server returns
  `InvalidArgument: Cannot exclude min_value=None` when `exclude_min=true` but no `min_value` is
  set. Hypothesis may generate (and shrink to) params with `exclude_min: true, min_value: null`
  from its database even if the strategy guarantees otherwise. Guard: `excludeMin = minValue !== null && params.exclude_min`.
- **TypeDoc `readme` option renders README.md on the index page.** Add `"readme": "README.md"`
  to `typedoc.json` so the documentation index page shows the project README. This gives users
  a nice landing page with quick-start examples before diving into the API reference.
- **Getting-started tutorial lives in `guide/getting-started.md`.** The `docs/` directory
  is reserved for TypeDoc generated output (gitignored), so the tutorial goes in `guide/`
  instead. Other libraries that don't have this constraint use `docs/getting-started.md`.
- **Examples directory does NOT need to be compiled or tested.** The `examples/` directory
  contains runnable TypeScript programs that demonstrate library usage. They are excluded from
  coverage measurement and ESLint/TypeScript checking. Keep them correct and idiomatic but
  do not add them to `tsconfig.json` or `vitest.config.ts`.
- **ESLint and Prettier must ignore `examples/`.** Add `examples/`
  to the ESLint global ignores block. The `docs/` directory is already ignored.
- **TypeDoc `treatWarningsAsErrors: true` catches broken `{@link}` references.** Any
  `{@link Foo}` or `@throws {Foo}` in JSDoc that references a non-exported symbol
  will fail the docs build. Always export symbols that appear in JSDoc links, or replace
  them with plain text.
- **Dead wrapper functions reduce readability with no benefit.** A function whose entire
  body is `return otherFunction(args)` is pure noise — the caller should call
  `otherFunction` directly. Remove such wrappers unless they serve a specific purpose
  (e.g. providing a different name, hiding a parameter, or enabling testing seams).
- **Consolidate same-module imports.** Two `import { ... } from "./same-module.js"` lines
  should always be merged into one. Duplicate imports from the same module are a lint
  smell that signals copy-paste maintenance.
- **`instanceof` is cleaner than duck-typed property checks.** `e instanceof RequestError`
  is more readable and type-safe than `e !== null && typeof e === "object" && "errorType" in e`.
  Prefer `instanceof` when the class is available.
- **README API signatures must match the actual function signatures.** Positional-parameter
  functions documented with option-object syntax (`lists(elements, { minSize?, maxSize? })`)
  confuse users. Keep the README code examples in sync with actual signatures.
- **`writePacket` should reuse a single header buffer.** Build the header with checksum=0,
  compute CRC32, then write the checksum into the same buffer. Do not allocate a second buffer
  and re-write all fields.
- **`readPacket` CRC check: zero the checksum field in place.** Instead of building a new
  buffer from three slices, just zero bytes 4-7 of the header buffer before computing CRC.
  The header buffer is a local variable that is not used after the check.
- **All functions have a `.name` property.** `Function.prototype.name` is part of ES2015.
  Do not cast `(fn as { name?: string }).name` — just use `fn.name` directly.
- **Remove dead guard clauses.** If a parameter is typed `Error | null`, checking
  `!== undefined` in addition to `!== null` is dead code.
- **`encodeValue` already returns `Buffer`.** Do not wrap `encodeValue(x)` in
  `Buffer.from(...)` — it creates an unnecessary copy. Pass the return value directly.
- **`childProcess.spawn` inherits `process.env` by default.** Do not pass
  `env: { ...process.env }` — it's a pointless spread that copies the entire env object.
- **Define sentinel symbols before using them.** `const` declarations are in a temporal
  dead zone before their declaration. Even though class field initializers run at
  construction time (so the symbol is defined by then), placing the symbol after the
  class that references it is confusing and non-idiomatic.
- **cbor-x `encode()` returns `Buffer` directly.** Do not wrap the result in `Buffer.from()`.
- **Extract `describeType(value)` helper for extractor error messages.** The pattern
  `value === null ? "null" : typeof value` appears in every CBOR extractor function.
  A shared `describeType` helper that also handles `Array.isArray` eliminates the
  repetition and keeps error messages consistent.
- **Use `0x80000000` for REPLY_BIT, not `1 << 31`.** JavaScript's `<<` returns a signed
  32-bit integer, so `1 << 31 === -2147483648`. This is confusing and inconsistent with the
  `CLOSE_STREAM_MESSAGE_ID` comment that warns against the same pattern. The hex literal
  `0x80000000` is `2147483648` (positive) and unambiguous. Bitwise operators still coerce it
  correctly for `|`, `&`, and `^` operations.
- **Don't pass default arguments explicitly.** When `stopSpan()` defaults `discard` to `false`,
  writing `stopSpan({ discard: false })` in 13 places is noise. Only pass `{ discard: true }`
  when overriding the default.
- **Span helpers must use try/finally.** `group()` must call `stopSpan()` in a `finally` block
  so the span is always closed, even if `fn()` throws. Otherwise a thrown exception (including
  `DataExhausted`) leaves the span open, corrupting the server's span stack.
- **`err.constructor?.name` optional chaining is intentional.** In `extractOrigin`, the
  parameter is typed `Error`, but callers may cast arbitrary objects to `Error` (e.g. in
  `_runTestCase`'s catch block with `e instanceof Error ? e : new Error(String(e))`). In the
  test suite, an object with `constructor: undefined` is used to exercise the fallback. The
  `?.` is not dead defensive code — it handles real edge cases in a dynamically-typed language.
