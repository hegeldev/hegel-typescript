> [!IMPORTANT]
> We're excited you're checking out Hegel! Hegel is in beta, and we'd love for you to try it and [report any feedback](https://github.com/hegeldev/hegel-typescript/issues/new).
>
> As part of our beta, we may make breaking changes if it makes Hegel a better property-based testing library. If that instability bothers you, please check back in a few months for a stable release!
>
> See https://hegel.dev/compatibility for more details.

# Hegel for TypeScript

- [Documentation](https://hegel.dev/typescript)
- [Website](https://hegel.dev)

Hegel is a property-based testing library for TypeScript. Hegel is based on [Hypothesis](https://github.com/hypothesisworks/hypothesis), using the [Hegel protocol](https://hegel.dev/).

## Installation

To install: `npm install --save-dev @hegeldev/hegel`.

Hegel requires Node 20.11+, Bun 1.2.5+, or Deno 2+. (Note that Deno requires `--allow-ffi --allow-read --allow-env`).

Linux amd64/arm64, macOS arm64, and Windows amd64/arm64 are supported.

Browser support uses the same package imports and initializes the Rust Wasm engine during ESM module loading. It requires top-level await and secure-context Web Crypto. Tests and shrinking run on the main thread; browser persistence is unsupported.

The upstream Wasm support is merged and published in libhegel 0.42.4. See [the browser guide](./BROWSER.md) for bundler configuration and how the Wasm module is packaged. Node, Bun and Deno continue to use Koffi.

## Quickstart

Here's a quick example of how to write a Hegel test:

```typescript
import { test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

function mySort(ls: number[]): number[] {
  const result = [...ls].sort((a, b) => a - b);
  return [...new Set(result)];
}

test("my_sort matches builtin", () =>
  hegel.test((tc) => {
    const vec1 = tc.draw(gs.arrays(gs.integers()));
    const vec2 = mySort(vec1);
    const sorted = [...vec1].sort((a, b) => a - b);
    if (JSON.stringify(sorted) !== JSON.stringify(vec2)) {
      throw new Error(`sort mismatch: ${JSON.stringify(sorted)} != ${JSON.stringify(vec2)}`);
    }
  }));
```

This test will fail when run with `vitest`! Hegel will produce a minimal failing test case for us:

```
Draw 1: [0, 0]
Error: sort mismatch: [0,0] != [0]
```

Hegel reports the minimal example showing that our sort is incorrectly dropping duplicates. If we remove the `new Set(...)` deduplication from `mySort()`, this test will then pass (because it's just comparing the standard sort against itself).

## Async tests

For async tests, use `hegel.testAsync`:

```typescript
import { test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

test("fetch returns a value matching its input", () =>
  hegel.testAsync(async (tc) => {
    const id = tc.draw(gs.integers({ minValue: 1, maxValue: 1000 }));
    const result = await fetchUser(id);
    if (result.id !== id) {
      throw new Error(`Expected id=${id}, got ${result.id}`);
    }
  }));
```

## Stateful tests

Some bugs only appear after a particular sequence of operations. For those, describe the operations as the rules of a state machine and let Hegel search over sequences of them with `hegel.stateful.run`:

```typescript
import { test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

const stackMachine: hegel.stateful.StateMachine<{ items: number[] }> = {
  rules: {
    push: (tc, stack) => {
      stack.items.push(tc.draw(gs.integers()));
    },
    pop: (tc, stack) => {
      tc.assume(stack.items.length > 0);
      stack.items.pop();
    },
  },
  invariants: {
    nonNegativeLength: (_tc, stack) => {
      if (stack.items.length < 0) throw new Error("negative length");
    },
  },
};

test("stack", () =>
  hegel.test((tc) => {
    hegel.stateful.run(tc, stackMachine, { items: [] });
  }));
```

Hegel picks the rules to run at each step, shrinks a failing sequence down to a minimal one, and reports it step by step (`Step 1: push`, `Step 2: pop`, …). See the `stateful` module in the documentation for invariants, step counts, asynchronous rules and `Pool`, which lets rules act on values that earlier rules produced.
