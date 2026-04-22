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

Hegel requires Node 16+. Bun and Deno are not currently supported.

Hegel will use [uv](https://docs.astral.sh/uv/) to install the required [hegel-core](https://github.com/hegeldev/hegel-core) server component.
If `uv` is already on your path, it will use that, otherwise it will download a private copy of it to ~/.cache/hegel and not put it on your path.
See https://hegel.dev/reference/installation for details.

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

test(
  "my_sort matches builtin",
  hegel.test((tc) => {
    const vec1 = tc.draw(gs.arrays(gs.integers()));
    const vec2 = mySort(vec1);
    const sorted = [...vec1].sort((a, b) => a - b);
    if (JSON.stringify(sorted) !== JSON.stringify(vec2)) {
      throw new Error(`sort mismatch: ${JSON.stringify(sorted)} != ${JSON.stringify(vec2)}`);
    }
  }),
);
```

This test will fail when run with `vitest`! Hegel will produce a minimal failing test case for us:

```
Draw 1: [0, 0]
Error: sort mismatch: [0,0] != [0]
```

Hegel reports the minimal example showing that our sort is incorrectly dropping duplicates. If we remove the `new Set(...)` deduplication from `mySort()`, this test will then pass (because it's just comparing the standard sort against itself).
