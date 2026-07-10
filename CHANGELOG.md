# Changelog

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
