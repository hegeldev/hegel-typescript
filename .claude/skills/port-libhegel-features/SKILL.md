---
name: port-libhegel-features
description: "How to expose new libhegel (hegel-c) capability in the public @hegeldev/hegel API after the pinned version moves. Use when the pin in src/libhegel-version.ts has advanced and you need to know what the engine gained and what to build on top of it, when asked to port a libhegel feature (a new generator, setting, result code, or protocol), when reviewing LIBHEGEL-PARITY.md, or when the port-libhegel-features workflow asks for a first stab at a version range."
---

# Porting new libhegel capability into the TypeScript API

`align-libhegel` keeps the binding **compiling** across an ABI change and is
deliberately API-preserving: it binds only what the front end already uses. So
capability the engine gains is never picked up by it. This skill is the
complement — given that libhegel moved from version A to version B, it answers
_what new capability is there, and how does it become public
`@hegeldev/hegel` API?_

Read `.claude/skills/align-libhegel/SKILL.md` first if you have not: the ABI
conventions (context-first, result-code return, trailing out-parameter,
caller-owned handles), the koffi specifics, and the layer map all apply
unchanged here and are assumed below.

The output of a port is **not** "every new symbol is bound". It is: the
mechanical features are implemented, tested and documented; the design-heavy
ones are written up in the ledger; and `LIBHEGEL-PARITY.md` says which is
which. A skipped feature that is not in the ledger is a feature nobody will
ever remember to revisit.

## 1. Determine what is new

Two sources, both from hegel-rust at the release tags. The tag is
`v<VERSION>` — the `v` prefix matters, the raw path without it 404s. The repo
is public, so no token is needed.

```bash
OLD=0.32.5   # the ledger's last_ported, or the range you were given
NEW=0.34.0   # the pin in src/libhegel-version.ts

for v in "$OLD" "$NEW"; do
  curl -sSL -o "/tmp/hegel-$v.h" \
    "https://raw.githubusercontent.com/hegeldev/hegel-rust/v$v/hegel-c/include/hegel.h"
done
diff -u "/tmp/hegel-$OLD.h" "/tmp/hegel-$NEW.h"
```

The raw diff is noisy (doc comments move). Get the symbol delta first, then
read the diff around each hit:

```bash
for v in "$OLD" "$NEW"; do
  grep -oE '\bhegel_[a-z0-9_]+\s*\(' "/tmp/hegel-$v.h" | tr -d ' (' | sort -u > "/tmp/syms-$v"
done
comm -13 "/tmp/syms-$OLD" "/tmp/syms-$NEW"   # added
comm -23 "/tmp/syms-$OLD" "/tmp/syms-$NEW"   # removed
```

Functions are not the whole delta. Also diff the non-function declarations —
these carry protocol changes that no new symbol announces:

```bash
diff <(grep -E '^\s*(HEGEL_|#define)' "/tmp/hegel-$OLD.h") \
     <(grep -E '^\s*(HEGEL_|#define)' "/tmp/hegel-$NEW.h")   # enum values, sentinels
diff <(grep -E '^typedef|_t;' "/tmp/hegel-$OLD.h") \
     <(grep -E '^typedef|_t;' "/tmp/hegel-$NEW.h")           # handles, structs
```

A sentinel whose _value_ changed (`HEGEL_STATE_MACHINE_DONE` went from `-1` to
`INT64_MIN` in 0.33.0) and a function whose _signature_ grew a parameter are
both invisible to the symbol delta and both break callers.

Then read the changelog:

```bash
curl -sSL "https://raw.githubusercontent.com/hegeldev/hegel-rust/v$NEW/hegel-c/CHANGELOG.md"
```

Read every entry between `## $OLD` and `## $NEW`, not just the top one. The
changelog is written for exactly this audience: it explains what a feature is
_for_, the call order a frontend is expected to use, which parts are the
frontend's choice, and what happens to frontends that ignore it. It is the
difference between binding a symbol and porting a feature. Header signatures
alone will not tell you that `hegel_recursion_finish` may report
`HEGEL_E_RETRY` and that the client is expected to drop the value and
regenerate from the root at most twice.

## 2. Classify every new capability

Group the delta into _features_, not symbols — twenty-one `hegel_printer_*`
entry points are one feature. Then put each feature in exactly one bucket.

**Mechanical — port it.** An additive generator, setting, result code, enum
value, or span label whose shape in TypeScript is obvious because the library
already has three of the same thing. The test is: can you name the existing
export it will look like, and the options-object fields, without inventing
anything? A new `hegel_generate_*` primitive is mechanical (`integers`,
`floats`, `dates` are all the same shape). A new
`hegel_settings_set_<name>(s, value)` is mechanical (it becomes a `Settings`
field with a default, wired in `runner.ts`). A new `hegel_result_t` code or
`hegel_run_status_t` value is mechanical when something in this client can
actually provoke it.

**Design-heavy — write it up, do not guess.** The feature needs a genuine
public-API decision in TypeScript: a new user-facing concept, a callback
protocol, a threading story, or a choice between several defensible shapes.
Symptoms: you cannot write the signature without picking between two designs;
the engine feature has no analogue anywhere in the current API; adopting it
would change what an existing public method _does_; it needs worker threads,
async, or a rendering model. **A bad guess at a printer API is worse than no
printer API** — it ships public surface the library then has to keep or break,
and it forecloses the design the owner would have chosen. Write the ledger
entry and stop.

**Not applicable — record and move on.** Engine-internal (shrinker,
distribution, database changes with no ABI surface), already covered by
existing API, or predicated on a feature this library does not have. The last
one matters: a change to the stateful protocol is not applicable to a library
with no stateful testing, but it is _not_ nothing — it belongs in the ledger
as part of the "stateful testing" gap so nobody re-derives it next time.

A feature can be split. If a family has one mechanical piece (an enum value)
and a design-heavy core (the protocol that produces it), porting the piece on
its own is usually dead code that fails the coverage gate — see §4. Prefer to
keep the family together in one ledger entry and say so.

## 3. What porting a generator actually involves

Traced from `arrays` / `sets` (`src/generators/collections.ts`) and the
integer path. Every one of these moves for a new engine-backed generator, in
this order:

1. **koffi prototype** — `bindLibrary` in `src/libhegel.ts`. A prototype
   string (`f("int hegel_generate_x(void* ctx, void* tc, ...)")`) unless the
   call passes a struct by value, which needs the `fs(name, [types])` helper
   with anonymous `koffi.struct` `TypeObject`s.
2. **`Bindings` field** — the typed wrapper surface in `src/libhegel.ts`. Any
   parameter the wrapper hardcodes rather than exposing must be documented
   here as a deliberate absorption.
3. **`Libhegel` method** — the ergonomic wrapper, also in `src/libhegel.ts`.
   It allocates the out-parameter array, funnels the result code through
   `this.check(ctx, code, "hegel_generate_x")`, normalizes the out value
   (`Number(...)` / `BigInt(...)` for 64-bit), and — if the call returns an
   engine-owned buffer — copies it with `Libhegel.copyNativeBuffer` and frees
   it in a `finally`.
4. **Schema IR + interpreter** — `src/generate.ts`. Add a `case "<type>"` to
   the `switch` in `generateValue`, and to `buildStringGenerator` instead if
   the draw goes through a `hegel_string_generator_t`. Compound draws follow
   `drawList` / `drawDict`: `lib.startSpan(ctx, tc, Labels.X)`, the draws,
   `lib.stopSpan(ctx, tc, false)`, with every handle freed in a `finally`.
   New span labels go in `Labels` in `src/testCase.ts` and **must mirror the
   `HEGEL_LABEL_*` values in the header** — the current entries are an exact
   subset of upstream 1–15, not client-invented numbers.
5. **Public generator** — a `class XGenerator<T> extends Generator<T>` plus a
   lowercase factory function in the right `src/generators/*.ts` file
   (`numeric.ts`, `strings.ts`, `collections.ts`, `combinators.ts`,
   `tuples.ts`, `compose.ts`). Options come in as a single optional
   options-object interface (`XOptions`), defaults applied with `??`, invalid
   combinations thrown as plain `Error` in the constructor. If the generator
   is expressible as one schema, build a `BasicGenerator` in the constructor
   and return it from `asBasic()` — that is what lets parent generators
   compose a single schema instead of falling back to span-based draws.
   Export the function and its options type from `src/generators/index.ts`.
6. **Docs** — typedoc runs over `src/index.ts` only, with
   `treatWarningsAsErrors: true` and `excludeInternal: true`. Every new public
   export needs TSDoc, and a broken `{@link}` **fails `just check-docs`**. If
   the feature is something a new user would look for, add it to the
   `@packageDocumentation` guide at the top of `src/index.ts`.
7. **Changelog** — a root `RELEASE.md`. Required by
   `.github/scripts/release.py check` for any PR touching `src/`, so a port PR
   always needs one. Follow `.claude/skills/changelog/SKILL.md`: an additive
   feature is `RELEASE_TYPE: patch` and opens `"This patch adds ..."`, with a
   short usage example.
8. **Tests** — see §4.

For a new _setting_ rather than a generator, steps 1–3 are the same and then:
add the field to the `Settings` interface and to `defaultSettings()` in
`src/runner.ts`, map it onto the `hegel_settings_set_*` call where the run's
settings handle is built, and cover both the default and an override.

## 4. The 100% coverage gate

`just check` enforces 100% lines, branches, functions **and statements**
(vitest thresholds in `vitest.config.ts` plus `scripts/check-coverage.py` as a
second pass over `coverage/coverage-summary.json`). Function coverage is the
one that bites: **an unexercised new binding fails the build.** Tests are part
of the port, not a follow-up, and a mechanical feature you cannot test is not
mechanical.

- Integration tests against the real engine are the default. One
  `tests/<feature>.test.ts` per generator, in the style of `tests/sets.test.ts`:
  `hegel.test((tc) => { ... }, { testCases: 30 })` with `expect` assertions on
  the drawn value. Cover every option branch — a `maxSize`-only and a
  `minSize`-only case, not just both-supplied.
- `tests/libhegel.test.ts` drives the wrapper directly, including real error
  paths (bad regex pattern, malformed blob).
- Branches the real engine cannot be driven into — a NULL return, a specific
  result code, a null string getter — use the **injected fake `Bindings`**
  (`fakeBindings({ ... })` in `tests/libhegel.test.ts`, documented in the
  align skill). Never fake anything the real library can do.
- A new public export should also be reachable through the namespace re-export
  checked by `tests/exports.test.ts`.
- No coverage-ignore comments. Drive the path or inject a fake.

This gate is also the reason not to bind a symbol speculatively: a binding
with no caller is not a harmless extra, it is a red build.

## 5. Public API discipline

- **Additive only.** Never change or remove existing public API in a port, and
  do not change what an existing method _does_. If a new engine facility would
  replace a client-side implementation of the same thing (the engine's
  `hegel_note` versus `TestCase.note`'s local `console.error`), that is a
  behavior change, which makes it design-heavy — ledger, not code.
- **Match the idiom.** Lowercase factory functions returning `Generator<T>`;
  a single optional options object with optional fields, never positional
  options; `camelCase` field names mapping to the schema's `snake_case` keys;
  synchronous draws (the FFI is synchronous — `testAsync` is about the _test
  body_, not about draws).
- Keep `src/libhegel.ts`'s header comment's version reference in step with the
  pin.

## 6. The ledger

`LIBHEGEL-PARITY.md` at the repo root is the porter's memory and the
workflow's baseline. It lives at the root because `docs/` is gitignored —
typedoc owns that directory and wipes it.

**Read it before you start.** Its `last_ported` line is the version the
previous port finished at, and its table already contains the reasoning for
everything previously skipped; a feature marked _needs design_ stays skipped
until a human decides otherwise, and you should not re-litigate it.

**Update it before you finish**, in the same PR:

- Move `last_ported` to the new pin. The
  `.github/workflows/port-libhegel-features.yml` workflow greps this line for
  its baseline, so keep the format exactly `last_ported: <x.y.z>` on its own
  line.
- One row per feature in the delta, with its status and the reason.
- For anything not ported, the reason must be usable a year later by someone
  who has not read the changelog.

## 7. When to stop

Stop at the first design decision you cannot make from existing precedent in
this repo. Do not prototype "something to start the discussion" in public API
— a draft PR full of guessed surface costs more review than an empty one.

A design-heavy ledger entry states three things:

1. **What the capability is** — in terms of what a user of this library could
   do with it, not in terms of C symbols.
2. **Why it needs a human decision** — the specific fork in the road.
3. **What the options look like** — the two or three shapes you considered,
   each with what it would cost. This is the part that makes the entry worth
   writing; without it the next porter starts from zero.

Then move on to the next feature. A port that lands three mechanical features
and three good write-ups is a success.

## 8. References

- `hegel-c/src/` in hegel-rust **at the release tag** — the implementation, for
  ownership, error codes, sentinel values, and anything the header comment
  leaves ambiguous.
- **hegel-go's `internal/libhegel/` and its public API** — a second, complete
  binding of the same ABI in another language. Reading how Go exposed a
  feature is the cheapest sanity check on your reading of the protocol, and on
  whether a feature is really design-heavy or just unfamiliar.
- The align skill's koffi section for marshalling; when the marshalling is
  unclear, prove it with a throwaway script against the real dylib
  (`node scripts/fetch-libhegel.mjs`) before committing to a binding shape.

## 9. Done

- `just check` passes — prettier, eslint, tsc, typedoc, and vitest at 100%
  coverage.
- `RELEASE.md` exists if `src/` changed.
- `LIBHEGEL-PARITY.md` has `last_ported` at the new pin and a row for every
  feature in the delta.
- The PR body lists what was ported and what was skipped, each skip with its
  reason — the same content as the ledger rows, so a reviewer does not have to
  open the file to see the verdict.
