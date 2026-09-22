RELEASE_TYPE: patch

This release adds browser support through the existing `@hegeldev/hegel` imports. Bundlers select a new browser entry through the package's `browser` export condition; it loads libhegel's published WebAssembly build during module evaluation (top-level await, so it needs an ES2022 target) and exposes the same `test()` and `testAsync()`. Node, Bun and Deno continue to use the native library. Generation and shrinking run on the browser's main thread, and browser test settings reject filesystem database paths (`Database.fromPath`). See `BROWSER.md` for bundler configuration.

It also adds `uuids()`, a generator for UUID strings (optionally of a given version).

It also adds stateful (model-based) testing, in the new `hegel.stateful` module, on both the native and the browser entry.

Describe a state machine as a plain object mapping rule names to rule functions and invariant names to invariant functions, then run it inside a test with `hegel.stateful.run(tc, machine, initialState)` (or `hegel.stateful.runAsync` for asynchronous rules). The engine chooses the sequence of rules, bounds it by the configurable `stepCount` (50 by default), samples the invariants between steps (or checks an invariant marked `alwaysCheck` after every step), and shrinks failing sequences like any other input; the failure report lists each step by rule name. `hegel.stateful.Pool` lets rules draw values that earlier rules produced, with `valuesReusable()` and `valuesConsumed()` generators.

Rule weights and concurrent machines, which the Rust and OCaml clients offer, are not included: they need a libhegel newer than the pinned release.
