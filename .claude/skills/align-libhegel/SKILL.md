---
name: align-libhegel
description: "How to align the TypeScript koffi FFI binding to a new libhegel (hegel-c) release. Use after bumping the pinned libhegel version (src/libhegel-version.ts, via `just update-libhegel`), when `just check` fails with a symbol-resolution or version-mismatch error against libhegel, or whenever the hegel-c C API in hegel.h has changed and the koffi bindings need to catch up."
---

# Aligning the TypeScript client to a new libhegel release

`libhegel` is a Rust cdylib built from hegel-rust's `hegel-c` crate. This
client calls it synchronously via the `koffi` FFI library — no subprocess, no
wire protocol. When the pinned version changes, the C API in
`hegel-c/include/hegel.h` may have added, removed, renamed, or re-typed
symbols, and the binding layer must be re-aligned. The public
`@hegeldev/hegel` API (`test`, `testAsync`, `Settings`, the generators) must
**not** change as a result — only the internal layers.

New capability the front end does not expose yet — a generator, setting, or
protocol the release added — is deliberately out of scope here, and is the job
of `.claude/skills/port-libhegel-features/SKILL.md`. This skill keeps the
binding compiling with the public API fixed; that one grows the public API and
records what it skipped in `LIBHEGEL-PARITY.md`.

The layers, and what an ABI change usually touches:

- **`src/libhegel.ts`** — the whole koffi surface. Three things move together
  here: the koffi prototype strings in `bindLibrary` (which must mirror the C
  signatures exactly), the `Bindings` interface (the typed, slightly slimmed
  wrapper surface), and the `Libhegel` class methods (ergonomic wrappers that
  map result codes to exceptions via `Libhegel.check`). Most alignments end
  here.
- **`src/generate.ts`** — the client-side schema interpreter. The ABI exposes
  one typed entry point per primitive draw (`hegel_generate_integer`,
  `hegel_generate_string`, …); this module walks the generators' schema IR and
  drives those calls, handling compound structure (`one_of`, `tuple`, `list`,
  `dict`, `constant`) client-side with shrinker spans and the collection
  protocol. Touch it when a draw entry point changes shape or a new one
  replaces schema-level behavior.
- **`src/runner.ts` / `src/session.ts`** — the run-lifecycle callers
  (`run_start` → `next_test_case` → `mark_complete` → `run_result`, plus
  failure replay via `hegel_test_case_from_blob`) and the process-global
  lazily-loaded library handle with its `major.minor` version check. Touch
  them only if the lifecycle protocol itself changes.
- **`src/wtf8.ts`** — decodes engine-returned string bytes (UTF-8 exactly,
  tolerant of lone surrogates). Touch only if string encoding changes.

**Within the binding layer, the koffi prototypes _must_ track the C API.**
When a C function gains a parameter, the prototype string in `bindLibrary`
grows with it. A behavior-preserving default for a new _optional_ parameter (a
NULL callback, a `0`-means-default flag) is absorbed inside `bindLibrary`'s
returned wrapper — but that absorption must be **documented in the `Bindings`
interface docs** so a future reader can tell a deliberate default from an
oversight. Example: the output callback taken by `hegel_run_start` /
`hegel_test_case_from_blob` is absorbed as NULL (engine output stays on
stderr), and the `Bindings` doc comment says so.

## The context-based ABI

Every fallible libhegel call follows one convention, and the binding is shaped
around it:

- The **first argument** is a `hegel_context_t*` (an error-reporting context).
- The **return value** is a `hegel_result_t` code (`HEGEL_OK` is 0; failures
  are negative — `-1` is `HEGEL_E_STOP_TEST`, `-2` is `HEGEL_E_ASSUME`).
- Any **value the call produces** (a handle, a count, a bool, a buffer) is
  written through a **trailing out-parameter**, never returned.
- On a non-OK return, the human-readable message is read back from the context
  via `hegel_context_last_error`.

`Libhegel.check(ctx, code, op)` funnels every fallible call: `HEGEL_E_STOP_TEST`
→ `StopTestError` (choice budget exhausted; the runner unwinds and calls
`mark_complete` with `OVERRUN`), `HEGEL_E_ASSUME` → `AssumeError` (engine
rejected a draw; `mark_complete` with `INVALID`), any other non-OK code →
`LibhegelError` carrying the context diagnostic. `mark_complete` is called
exactly once per test case.

Calls that cannot fail for the inputs this client gives them (constructors,
frees, setters, result getters) pass a NULL context — the ABI accepts that,
simply opting out of error messages — and `bindLibrary` discards their result
code, presenting them as value-returning wrappers on `Bindings`.

### Ownership: everything written back is a caller-owned copy

koffi frees nothing. Every handle the ABI writes back must be released with
its matching free, and the frees live in `finally` blocks so error paths
release too:

- The runner (`src/runner.ts`, nested `finally` blocks at the end of the run
  loop) frees the `Context`, `Settings`, and `Run` handles, each test case
  from `hegel_next_test_case`, the run result, each failure from
  `hegel_run_result_failure`, and each replay test case from
  `hegel_test_case_from_blob`.
- The interpreter (`src/generate.ts`, `drawList`/`drawDict`) frees each
  collection from `hegel_new_collection` in a `finally`.
- Engine-owned `{data, len}` buffer results (`hegel_generate_bytes`,
  `hegel_generate_string`) are **copied immediately** into a JS `Buffer`
  (`Libhegel.copyNativeBuffer`) and then freed with their matching
  `*_result_free` — never hold the raw pointer past the free.
- **Deliberate exception**: `hegel_string_generator_t` handles are immutable
  and shareable, so `generate.ts` caches one per schema object (a `WeakMap`)
  for the life of the process and never frees them; their free function is
  intentionally not bound. Keep it that way unless the ABI makes them
  per-test-case.

## 1. Find the pinned version and fetch the matching header

The pin lives in `src/libhegel-version.ts` as `LIBHEGEL_VERSION`. It is
generated code — regenerate with `just update-libhegel [version]`, never edit
by hand.

The release **tag is `v<VERSION>`** (note the `v` prefix — the raw path
without it 404s):

```bash
curl -sSL https://raw.githubusercontent.com/hegeldev/hegel-rust/v<VERSION>/hegel-c/include/hegel.h
```

Diff it against the previous pin's header first — if the two are identical,
the alignment is a no-op and you only need `just check` to confirm.

## 2. Get the matching library

`just test` / `just check` wire this up themselves: `just check-test` sets
`HEGEL_LIBHEGEL_PATH` from `node scripts/fetch-libhegel.mjs`, which downloads
the pinned release's artifact into `native/<VERSION>/` (the versioned path is
the cache invalidation — a pin bump misses and re-downloads). To get the path
by hand:

```bash
LIB=$(node scripts/fetch-libhegel.mjs)
```

**When you need the symbol table**, run `nm` against that artifact — ground
truth for which `hegel_*` symbols exist:

```bash
nm -gU "$LIB" | grep hegel_ | sort     # macOS .dylib
nm -D  "$LIB" | grep ' T hegel_' | sort  # Linux .so
```

koffi resolves each symbol when `bindLibrary` calls `lib.func(...)`, at first
library load — a symbol the binding declares but the lib no longer exports
throws there, so **every** integration test dies at load with the missing
symbol's name.

## 3. Compare hegel.h against `src/libhegel.ts`

Walk every C declaration and check it against the binding. For each function
this client uses, three places move together: the **prototype string** (or
`fs(...)` type-array call) in `bindLibrary`, the **`Bindings`** field, and the
**`Libhegel`** method. Categorize each header change:

- **Removed symbol** → delete its prototype, `Bindings` field, wrapper method,
  and callers. Re-route the front end.
- **Renamed/retyped symbol** → update all three together, plus any caller that
  consumed the old shape.
- **New symbol** → bind it **only if the front end needs it** (see §5 — the
  coverage gate forbids dead bindings). If nothing calls it, it is new
  capability, not an alignment: note it in the commit message and leave it to
  `port-libhegel-features`.
- **Changed signature** (a new arg, or a value moving from return to
  out-param) → remember the convention: ctx first, result-code return,
  produced value through a trailing out-param. A new _optional_ arg with a
  behavior-preserving default may be absorbed in `bindLibrary`'s wrapper, but
  document the absorption in the `Bindings` docs.
- **Changed enum/constant values** → update the exported `const` objects
  (`Status`, `RunStatus`, `NativeVerbosity`) and the `RESULT_*` codes at the
  top of `src/libhegel.ts`, and the `Labels` in `src/testCase.ts` if the
  `HEGEL_LABEL_*` values moved. Client-invented labels must sit past the last
  upstream value so they can't collide.
- **Changed struct layout** (`hegel_date_t`, `hegel_time_t`,
  `hegel_datetime_t`, the `*_result_t` buffer structs) → update the
  `koffi.struct({...})` type objects near the top of `src/libhegel.ts` and the
  matching `Native*` interfaces. Field order and integer widths must mirror
  the C struct exactly; koffi handles alignment/padding itself from the field
  types.

## 4. koffi specifics — the things that bite

- **Struct types must stay anonymous**: `koffi.struct({...})`, never
  `koffi.struct("name", {...})`. koffi's named-type registry is
  **process-global and survives vitest worker module reloads**, so a named
  registration throws "duplicate type name" the second time a test file loads
  the module. The existing code is anonymous for this reason; keep it that
  way.
- Prototype strings (`lib.func("int hegel_x(void* ctx, ...)")`) are the
  default and self-documenting. Functions taking **structs by value** cannot
  be expressed with anonymous types in string form — those use the
  `fs(name, [types])` helper with the `TypeObject`s and
  `koffi.out(koffi.pointer(t))` for the out-param (see `hegel_generate_date` /
  `hegel_generate_bytes`).
- **Out-parameters are single-element JS arrays**: declare `_Out_ T*` in the
  prototype, pass `[null]` / `[0]` / `[false]`, read `out[0]` after the call.
  A `_Out_ char**` comes back as a JS string (or `null` for the engine's
  "no string"); a raw byte pointer must be bound `uint8_t*` (not `char*`) so
  koffi hands back the pointer for `koffi.decode(ptr, "uint8_t", len)` —
  the buffers are not NUL-terminated and may contain interior NULs.
- **64-bit integers**: pass `bigint` for `int64_t`/`uint64_t` args; a 64-bit
  out-param may come back as `number | bigint` — normalize (`BigInt(out[0])`
  or `Number(...)`) at the wrapper. `0xffffffffffffffffn` (`UINT64_MAX`) is
  the "no bound" sentinel for size arguments.
- **Byte-buffer arguments** (`const uint8_t* p, size_t len`): pass a Node
  `Buffer` and its `.length`; `null` for an absent optional buffer. Fixed-size
  out buffers (`hegel_generate_ipv4/6`) are preallocated `Buffer.alloc(n)`
  passed as `_Out_ uint8_t*`.
- **String arrays** (`const char** items, size_t len`): pass a JS
  `readonly string[]` (koffi marshals it) plus its length, `null`/`0` when
  absent.
- **When the marshalling is unclear from the header, prove it empirically
  before committing to a binding shape**: write a throwaway script that
  `koffi.load`s the real dylib (path from `node scripts/fetch-libhegel.mjs`),
  binds just the one function, and round-trips a value. Ten minutes of smoke
  script beats an afternoon of debugging a garbage struct field. Delete the
  script afterwards.
- **References for unclear semantics**: the implementation is
  `hegel-c/src/` in hegel-rust _at the release tag_ (ownership, error codes,
  sentinel values), and hegel-go's `internal/libhegel/` is a second, complete
  binding of the same ABI to sanity-check your reading against.

## 5. Coverage and tests

`just check` enforces **100% coverage** (vitest v8 thresholds plus
`scripts/check-coverage.py`), including 100% _function_ coverage — so **a
binding nothing calls fails the build**. Bind only the functions the front end
actually uses, and land coverage in the same change as the binding:

- Integration coverage against the real engine: the generator tests
  (`tests/integers.test.ts`, `tests/text.test.ts`, …) exercise the draw paths;
  `tests/libhegel.test.ts` drives the wrapper directly, including real error
  paths (bad regex pattern, malformed blob, …).
- The few branches the real engine can't be driven into (NULL returns,
  specific result codes, null string getters) use an **injected fake
  `Bindings`** — see the fake-bindings section of `tests/libhegel.test.ts`.
  Never mock the engine for anything the real library can do.
- Pure helpers (formatting, wire-format encode/decode, schema validation
  errors) get plain unit tests (`tests/generate.test.ts`,
  `tests/libhegel.test.ts`).
- No coverage-ignore comments. Drive the path or inject a fake; don't annotate.
- Vitest ESM note: `vi.spyOn(fs, ...)` throws on frozen ESM namespaces — use a
  hoisted `vi.mock("node:fs", ...)` factory and `vi.mocked(...)` instead.

## 6. Verify

```bash
just check    # prettier + eslint + tsc + typedoc + vitest with 100% coverage
```

Then run the smoke fixture against the real library (it exercises the built
`dist/`, so build first):

```bash
npx tsc
HEGEL_LIBHEGEL_PATH=$(node scripts/fetch-libhegel.mjs) node tests/smoke/run-hegel-test.mjs
```

Exit code 0 is the pass signal — it intentionally prints a failing property's
error output along the way.

## 7. Validation gate — independent completeness audit

The steps above are done by the same context that made the edits, so they
share its blind spots: a symbol you never noticed in the header is a symbol
you also won't notice is misbound. Close that gap with a **fresh-context
audit** as the final gate. Launch a separate agent (Task tool,
`subagent_type: "general-purpose"`) that has _not_ seen your edits and whose
only job is to check the binding against the header.

Give the agent a self-contained prompt — it starts with no context:

```
Audit the libhegel koffi FFI binding for correctness against the C header. Do
NOT edit anything — this is a read-only verification.

1. Read the pinned version from src/libhegel-version.ts (LIBHEGEL_VERSION).
2. Fetch the matching header:
   curl -sSL https://raw.githubusercontent.com/hegeldev/hegel-rust/v<VERSION>/hegel-c/include/hegel.h
   (note the `v` prefix on the tag).
3. Extract every `hegel_*` function declared in the header.
4. Cross-check each against src/libhegel.ts. A function the client uses must
   have (a) a koffi prototype in bindLibrary whose parameter types match the C
   prototype literally — including integer widths and signedness — (b) a
   Bindings field, and (c) a Libhegel method. A header function with NO
   binding is fine only if nothing in src/ needs it (this client deliberately
   binds only what it uses; hegel_string_generator_free is deliberately
   unbound). Flag any bound symbol that is NOT in the header (breaks every
   test at library load).
5. For every parameter a bindLibrary wrapper absorbs (hardcodes rather than
   exposes on Bindings), check the Bindings interface docs explain the
   absorption. An undocumented absorbed parameter is a BURIED-DEFAULT — flag
   it.
6. Check the struct TypeObjects (date/time/datetime/buffer-result) field
   order and widths against the C structs.

Report a table of every header function with OK / MISSING / SIGNATURE-MISMATCH
/ BURIED-DEFAULT / UNBOUND-UNUSED, and a final verdict line. List
discrepancies explicitly; do not fix them.
```

The agent's report is the gate: if it comes back clean, the alignment is
complete. If it flags a `MISSING` or `SIGNATURE-MISMATCH`, return to §3–§5,
fix it, and re-run this gate. This is a genuine independent check only because
the agent rederives the header→binding mapping from scratch — do not paste
your own diff or conclusions into its prompt.
