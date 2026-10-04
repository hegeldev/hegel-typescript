# libhegel parity

What `libhegel` can do, and what `@hegeldev/hegel` exposes of it.

The bump pipeline (`bump-hegel-rust.yml` → the `align-libhegel` skill) is
API-preserving by design: it keeps the koffi binding compiling and never grows
the public API. New engine capability therefore has to be picked up
separately, by `port-libhegel-features.yml` and the
`port-libhegel-features` skill. This file is that process's memory: a feature
skipped once and not recorded here is invisible forever.

last_ported: 0.32.5

`last_ported` is the version the last completed port covered. The workflow
greps this line for its baseline, so keep the format exactly
`last_ported: <x.y.z>` on a line of its own. It is deliberately behind the pin
in `src/libhegel-version.ts` while the backlog below is unported.

Status vocabulary:

| Status         | Meaning                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| `ported`       | Exposed in the public API.                                                  |
| `to port`      | Classified mechanical; the shape is settled, the work is not done.          |
| `needs design` | Requires a public-API decision in TypeScript. Do not guess — see the notes. |
| `omitted`      | Deliberately not exposed, for the stated reason.                            |
| `n/a`          | No public surface to expose.                                                |

## 0.32.5 → 0.34.0

Derived by diffing `hegel-c/include/hegel.h` between tags `v0.32.5` and
`v0.34.0` and reading the `hegel-c/CHANGELOG.md` entries in between. The delta
is 32 new functions, one new result code, one new run status, two new span
labels, one changed sentinel value, and three changed signatures. Grouped into
features:

| Feature                          | libhegel surface                                                                                                                        | Status         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Recursive generation             | `hegel_new_recursion`, `hegel_recursion_branch` / `_leaf` / `_retry` / `_finish` / `_free`; `HEGEL_E_RETRY`; `HEGEL_LABEL_RECURSIVE`    | `to port`      |
| Pretty-printer document API      | 21 `hegel_printer_*` entry points, `hegel_test_case_printer`, `hegel_note`                                                              | `needs design` |
| Stateful testing (round-based)   | `hegel_state_machine_next_group`, `_should_check_invariant`, reworked `hegel_new_state_machine` / `_next_rule` / `_rule_rejected`       | `needs design` |
| Nondeterministic-run reporting   | `hegel_test_case_is_nondeterministic`, `HEGEL_RUN_STATUS_FAILED_NONDETERMINISTIC`, `HEGEL_LABEL_CONCURRENCY`                            | `omitted`      |
| Generation and shrinking quality | No ABI surface (0.32.x shrinker work, 0.33.1 integer swarm testing and f32 distribution, 0.33.3/0.33.5 recursion sizing and span guard) | `n/a`          |

### Recursive generation — `to port`

Users can generate recursively defined data (trees, JSON documents) with the
same distribution every other Hegel frontend gets, instead of hand-rolling a
depth counter. The engine owns branch probabilities, the depth limit, the leaf
budget, and a per-value target size; the client drives a protocol and wraps
each sub-value in a `HEGEL_LABEL_RECURSIVE` span so the shrinker can replace a
tree with one of its own subtrees.

Classified mechanical because the public shape does not need inventing.
hegel-rust exposes `gs::recursive(leaf, branch)` (`src/generators/recursive.rs`),
where the base case is a generator and the recursive step is a function handed
a subtree generator, with `max_depth` / `max_leaves` options defaulting to 32
and 100. The TypeScript translation follows the repo's own idiom directly:

```ts
recursive<T>(
  leaf: Generator<T>,
  branch: (subtree: Generator<T>) => Generator<T>,
  options?: { maxDepth?: number; maxLeaves?: number },
): Generator<T>;
```

What the port has to build, beyond the five bindings:

- A `RetryError` for `HEGEL_E_RETRY` (`-10`) alongside `StopTestError` and
  `AssumeError` in `Libhegel.check`, and the attempt loop that catches it,
  calls `hegel_recursion_retry`, and restarts from the root. Rust needs
  `catch_unwind` for this; a thrown error is the natural TypeScript form.
- `HEGEL_LABEL_RECURSIVE = 35` in `Labels` (`src/testCase.ts`).
- Recursion methods on the internal `DataSource` interface, since the
  generator drives the engine directly rather than through the schema IR.
- Restoring span nesting after an aborted attempt. `TestCase` tracks
  `spanDepth` privately with no way to unwind it to a mark; hegel-rust has
  `reset_open_spans_to` for exactly this. This is the one non-obvious piece.

hegel-go binds the protocol in `internal/libhegel/` but exposes nothing and
never drives the retry loop, so it is not a useful second reading here; use
hegel-rust's `draw_recursive` / `draw_subtree`.

### Pretty-printer document API — `needs design`

**Capability.** The engine ships an Oppen-style layout engine so a frontend
can report drawn values through libhegel instead of formatting them itself:
grouping, breakable and hard breaks, indentation, comments, deferred holes
filled in later, and speculative regions a rejected draw can retract. Every
test case owns one document; `hegel_test_case_printer` gets a handle on it and
`hegel_note` appends note lines. Cloned test-case handles anchor their region
at the clone point, so concurrent generation renders deterministically.

**Why a human decides.** This library already solves the same problem its own
way, and adopting the engine's version replaces that rather than adding to it.
`TestCase.draw` prints `var draw_N = <node:util inspect>` on the final replay
and `TestCase.note` writes straight to `console.error`. Routing either through
the document changes where output goes (engine stderr, at the engine's
timing), what it looks like, and how the two interleave — a behavior change to
existing public API, which a port is not allowed to make on its own authority.
Underneath that sit real design forks with no TypeScript precedent to copy:
hegel-rust built a `PrettyPrintable` trait plus a derive macro plus
`Generator::print_with` / `print_as_value` / `print_as_debug`, a design that
leans on traits and macros TypeScript does not have; hegel-go declined the ABI
entirely and formats values with the standard library's `go/printer`.

**Options.**

1. **Do nothing.** `node:util`'s `inspect` already produces good output for JS
   values and costs nothing to maintain. The loss is cross-language
   consistency and any value too large to print flat.
2. **Adopt `hegel_note` only** — keep `inspect` for drawn values, send
   `TestCase.note` text to the engine document. Small, but still changes when
   and where notes appear, and buys little on its own.
3. **A `PrettyPrintable`-style interface plus opt-in generator hooks** — the
   closest analogue of hegel-rust, e.g. an optional `prettyPrint(printer)`
   method recognized on drawn values and a `.printWith()` combinator on
   `Generator`. The largest surface, and the only option that gets the
   speculative-region and deferred-hole machinery, which is what makes
   printing _during_ generation correct under filters and retries.

Option 3 becomes load-bearing if recursive generation lands: the
Rust implementation wraps each recursion attempt in a speculative print region
so discarded attempts do not leak into the report. Without a printer there is
nothing to leak, so the two are independent for now — but they stop being
independent once printing exists.

### Stateful testing (round-based) — `needs design`

**Capability.** Model-based testing: the user declares rules and invariants,
the engine schedules them, shrinks the failing sequence, and — since 0.33.0 —
can run rules concurrently across worker threads, with rules assigned to
concurrency groups so that only one group runs per round.

**Why a human decides.** This library has no stateful testing at all, so this
is not a delta to catch up on but a feature to design. There is no `Pool`, no
state machine, no rule concept anywhere in `src/`, and the 0.33.0/0.34.0
changes (the round protocol, `worker_index`, `HEGEL_STATE_MACHINE_DONE` moving
from `-1` to `INT64_MIN`) only matter once there is a caller to change. The
two existing frontends made opposite host-language choices — hegel-rust uses a
`StateMachine` trait with `#[hegel::state_machine]` attribute macros,
hegel-go discovers rules by reflecting over `Rule…` / `Invariant…` method-name
prefixes — and neither translates to TypeScript, which has no macros and no
useful runtime reflection over method intent.

**Options** (the sequential API first; concurrency is a second decision).

1. **A class with decorated or prefixed methods.** Familiar from
   Hypothesis's `RuleBasedStateMachine`, but TypeScript decorators are still
   awkward to ship (`experimentalDecorators`, emit-target coupling), and
   name-prefix reflection is fragile in a language with minification.
2. **A declarative object of rules**, e.g.
   `stateful({ initial, rules: { push: { group, run(state, tc) {…} } }, invariants: {…} })`.
   No decorators, no reflection, straightforward to type; less familiar to
   users coming from Hypothesis.

Concurrency is a separate and larger question: `max_concurrency > 1` means
real worker threads, which for this library means `node:worker_threads`,
structured-clone boundaries on user state, and driving cloned test-case
handles across threads through koffi. **Sequential-only is a legitimate first
milestone** — it is the degenerate case of the same protocol (all-zero rule
groups, concurrency bounds `1, 1`, no workers, `hegel_state_machine_next_group`
between rules) and it needs no threading story. Decide sequential first.

`hegel_state_machine_should_check_invariant` (new in 0.34.0) is part of
whatever lands: it is the engine's per-invariant sampling decision at each
round boundary, with the guaranteed initial and final checks run
unconditionally. hegel-go, pinned to 0.33.2, does not bind it and runs every
invariant every round.

### Nondeterministic-run reporting — `omitted`

`hegel_test_case_is_nondeterministic`, `HEGEL_RUN_STATUS_FAILED_NONDETERMINISTIC`
(`3`) and `HEGEL_LABEL_CONCURRENCY` (`34`) exist to support concurrent
stateful runs, which cannot be replayed: the frontend captures the trace at
discovery, and skips the final replay and the reproducer. Only a state machine
created with `max_concurrency > 1` declares a run nondeterministic, so nothing
this library can construct reaches any of it.

Omitted rather than ported because the constants alone buy nothing and the
handling they imply is unreachable code under the 100% coverage gate. One
hazard to remember when stateful testing does land: `src/runner.ts` treats any
run status that is neither `PASSED` nor `ERROR` as `FAILED` and replays each
counterexample's blob, which is exactly what a nondeterministic failure must
not do.

### Generation and shrinking quality — `n/a`

Engine-internal improvements with no ABI surface, which arrive with the pin:
cheaper shrinking and better branch escape (0.32.4), a fresh stall budget per
scheduling round (0.32.5), swarm-testing-based boundary-value injection for
wide integer ranges and fixed unbounded `f32` distribution (0.33.1), and two
recursion sizing fixes (0.33.3, 0.33.5). Listed so a later reader can see they
were considered.

## Known gaps outside this range

This table covers only `0.32.5 → 0.34.0`. Capability that predates `0.32.5`
and is still unexposed has never been inventoried. The clearest example:
`Labels` in `src/testCase.ts` mirrors `HEGEL_LABEL_*` values 1–15 exactly, but
upstream defines up to 35 — the per-primitive labels (`HEGEL_LABEL_INTEGER`,
`_FLOAT`, `_STRING`, `_REGEX`, …, 16–33) are unused here. Auditing that
backlog is its own job, not part of a version-range port.
