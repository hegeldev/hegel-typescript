RELEASE_TYPE: patch

This release adds browser support through the existing `@hegeldev/hegel` imports. Bundlers select a new browser entry through the package's `browser` export condition; it loads libhegel's published WebAssembly build during module evaluation (top-level await, so it needs an ES2022 target) and exposes the same `test()` and `testAsync()`. Node, Bun and Deno continue to use the native library. Generation and shrinking run on the browser's main thread, and browser test settings reject filesystem database paths (`Database.fromPath`). See `BROWSER.md` for bundler configuration.

It also adds `uuids()`, a generator for UUID strings (optionally of a given version).
