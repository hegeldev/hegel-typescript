# Changelog

## 0.4.7 - 2026-09-24

This release adds browser support through the existing `@hegeldev/hegel` imports. Bundlers select a new browser entry through the package's `browser` export condition; it loads libhegel's published WebAssembly build during module evaluation (top-level await, so it needs an ES2022 target) and exposes the same `test()` and `testAsync()`. Node, Bun and Deno continue to use the native library. Generation and shrinking run on the browser's main thread, and browser test settings reject filesystem database paths (`Database.fromPath`). See `BROWSER.md` for bundler configuration.

It also adds `uuids()`, a generator for UUID strings (optionally of a given version).

## 0.4.6 - 2026-09-17

This patch bumps our pinned libhegel ([hegel-rust](https://github.com/hegeldev/hegel-rust)) from [0.32.5](https://github.com/hegeldev/hegel-rust/releases/tag/libhegel-v0.32.5) to [0.42.4](https://github.com/hegeldev/hegel-rust/releases/tag/libhegel-v0.42.4), and follows hegel-rust's new release tags: libhegel binaries now hang off `libhegel-v<version>` tags, so the fetch script, the bump workflow and the FFI alignment guide all use those.

Aligning to the new engine changes two things users can see:

- `times()` and `datetimes()` now draw with nanosecond precision. Values on a whole microsecond keep their previous `HH:MM:SS.ffffff` form; other values print all nine fractional digits.
- libhegel now resolves a default settings profile (from `HEGEL_DEFAULT_PROFILE` or a `hegel.toml`) when a run starts. If that fails — an unknown profile name, a malformed `hegel.toml` — `hegel.test` now throws the engine's diagnostic instead of crashing on a null handle.

It also fixes the mapping of the `Quiet` and `Normal` verbosity levels, which libhegel 0.42 renumbered.

## 0.4.5 - 2026-08-13

This patch bumps our pinned libhegel ([hegel-rust](hegeldev/hegel-rust)) from [0.32.4](https://github.com/hegeldev/hegel-rust/releases/tag/v0.32.4) to [0.32.5](https://github.com/hegeldev/hegel-rust/releases/tag/v0.32.5).

## 0.4.4 - 2026-08-13

This patch bumps our pinned libhegel ([hegel-rust](hegeldev/hegel-rust)) from [0.23.0](https://github.com/hegeldev/hegel-rust/releases/tag/v0.23.0) to [0.32.4](https://github.com/hegeldev/hegel-rust/releases/tag/v0.32.4).

## 0.4.3 - 2026-07-24

Hegel now officially supports Bun 1.2.5+ and Deno 2+. (Deno requires `--allow-ffi --allow-read --allow-env`).

## 0.4.2 - 2026-07-23

The native libhegel shared libraries are now distributed as per-platform npm
packages (`@hegeldev/hegel-linux-x64`, `@hegeldev/hegel-darwin-arm64`, ...)
instead of all being bundled inside the main package. Your package manager
automatically installs the single package matching your platform. No action is
required.

## 0.4.1 - 2026-07-21

Remove the `Property test failed:` prefix from the error thrown when a property fails.

## 0.4.0 - 2026-07-09

This release changes the default value of `fullmatch` in `fromRegex` from `false` to `true`.

## 0.3.1 - 2026-06-29

This patch adds the `reportMultipleFailures` setting. When enabled, a run keeps
generating after the first failure to surface additional *distinct* failures
(each with a different origin); when disabled, the run stops after the first
failing example. It defaults to `false`.

```ts
hegel.test(fn, { reportMultipleFailures: true });
```

## 0.3.0 - 2026-06-26

hegel-typescript now uses [libhegel](https://github.com/hegeldev/hegel-rust) — the native
Rust engine — directly via FFI, instead of spawning the `hegel-core` Python
server and talking to it over a socket protocol.

The public API is unchanged. Two user-visible requirement changes:

- Hegel no longer needs Python or `uv`.
- Hegel now requires Node 20.11+ (the native FFI layer uses a loader that
  depends on a recent Node).

## 0.2.3 - 2026-05-26

This patch bumps our pinned hegel-core from [0.6.0](https://github.com/hegeldev/hegel-core/releases/tag/v0.6.0) to [0.9.1](https://github.com/hegeldev/hegel-core/releases/tag/v0.9.1).

## 0.2.2 - 2026-05-14

We now automatically derive a database key based on the source code of the function. This allows Hegel to automatically replay previous failures. See https://github.com/hegeldev/hegel-typescript/issues/36.

## 0.2.1 - 2026-05-09

This release makes `generators` reachable as a namespace from `@hegeldev/hegel`:

```typescript
// A
import * as hegel from "@hegeldev/hegel";
hegel.generators.integers()

// B, still works as before:
import * as gs from "@hegeldev/hegel/generators";
gs.integers()
```

We still recommend option B.

This release also removes a number of private APIs from the public exports of `@hegeldev/hegel`.

## 0.2.0 - 2026-05-04

This release changes `hegel.test` to execute immediately when called, instead of returning a callable which must be called to run the property-based test.

For example, here's how to migrate `vitest` tests to this release:

```typescript
// before
test("my test", hegel.test(...))

// after
test("my test", () => hegel.test(...))
```

This release also adds `hegel.testAsync`, for use with async tests:

```typescript
test("my async test", () =>
  hegel.testAsync(async (tc) => {
    const id = tc.draw(gs.integers({ minValue: 1 }));
    await fetchUser(id);
  }),
);
```

## 0.1.5 - 2026-04-30

Internal refactor.

## 0.1.4 - 2026-04-29

Internal refactor of `oneOf`.

## 0.1.3 - 2026-04-28

Bump our pinned `hegel-core` version from `0.4.0` to [`0.4.14`](https://github.com/hegeldev/hegel-core/releases/tag/v0.4.14).

## 0.1.2 - 2026-04-25

Loosen the type of `sampledFrom` and `text({categories: ...})` to accept `readonly` arrays.

## 0.1.1 - 2026-04-22

Internal refactor in preparation for release.

## 0.1.0 - 2026-04-21

Initial release!
