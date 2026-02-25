# Getting Started with Hegel (TypeScript)

## Install Hegel

Install the Python backend and the TypeScript SDK:

```bash
pip install "git+ssh://git@github.com/antithesishq/hegel-core.git"
npm install hegel-typescript
```

If you are working inside this repository, `just setup` handles both steps.

## Write your first test

Create `example.test.ts`:

```typescript
import { runHegelTest, integers } from "hegel-typescript";

it("integers are integers", async () => {
  await runHegelTest(async () => {
    const n = await integers().generate();
    console.log(`called with ${n}`);
    expect(typeof n).toBe("number");
  });
});
```

`runHegelTest` runs the test body many times with different random inputs. Inside
the body, call `.generate()` on a generator to produce a value. If any assertion
fails, Hegel shrinks the inputs to a minimal counterexample.

By default Hegel runs **100 test cases**. Override this with the `testCases` option:

```typescript
await runHegelTest(async () => { ... }, { testCases: 500 });
```

## Running in a test suite

Hegel tests integrate with any test runner (Vitest, Jest, etc.):

```typescript
import { runHegelTest, integers } from "hegel-typescript";

it("bounded integers", async () => {
  await runHegelTest(async () => {
    const n = await integers(0, 200).generate();
    expect(n).toBeLessThan(50); // this will fail!
  });
});
```

When a test fails, Hegel shrinks the counterexample to the smallest value that
still triggers the failure — in this case, `n = 50`.

## Generating multiple values

Call `.generate()` multiple times to produce multiple values in a single test:

```typescript
import { runHegelTest, integers, text } from "hegel-typescript";

it("multiple generators", async () => {
  await runHegelTest(async () => {
    const n = await integers().generate();
    const s = await text().generate();
    expect(typeof n).toBe("number");
    expect(typeof s).toBe("string");
  });
});
```

Because generation is imperative, you can call `.generate()` at any point —
including conditionally or in loops.

## Filtering

Use `.filter()` for simple conditions on generators:

```typescript
import { runHegelTest, integers } from "hegel-typescript";

it("even integers", async () => {
  await runHegelTest(async () => {
    const n = await integers()
      .filter((n) => n % 2 === 0)
      .generate();
    expect(n % 2).toBe(0);
  });
});
```

For conditions that depend on multiple generated values, use `assume()` inside
the test body:

```typescript
import { runHegelTest, integers, assume } from "hegel-typescript";

it("Euclidean division identity", async () => {
  await runHegelTest(async () => {
    const n1 = await integers().generate();
    const n2 = await integers().generate();
    assume(n2 !== 0);

    const q = Math.trunc(n1 / n2);
    const r = n1 % n2;
    expect(q * n2 + r).toBe(n1);
  });
});
```

Using bounds and `.map()` is more efficient than `.filter()` or `assume()` because
they avoid generating values that will be rejected.

## Transforming generated values

Use `.map()` to transform values after generation:

```typescript
import { runHegelTest, integers } from "hegel-typescript";

it("stringified integers", async () => {
  await runHegelTest(async () => {
    const s = await integers(0, 100).map(String).generate();
    expect(s).toMatch(/^\d+$/);
  });
});
```

## Dependent generation

Because generation is imperative in Hegel, you can use earlier results to configure
later generators directly:

```typescript
import { runHegelTest, integers, lists } from "hegel-typescript";

it("list with valid index", async () => {
  await runHegelTest(async () => {
    const n = await integers(1, 10).generate();
    const lst = await lists(integers(), n, n).generate();
    const index = await integers(0, n - 1).generate();
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(lst.length);
  });
});
```

You can also use `.flatMap()` for dependent generation within a single generator
expression:

```typescript
import { runHegelTest, integers, lists } from "hegel-typescript";

it("flatMap dependent generation", async () => {
  await runHegelTest(async () => {
    const result = await integers(1, 5)
      .flatMap((n) => lists(integers(), n, n))
      .generate();
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThanOrEqual(5);
  });
});
```

## What you can generate

### Primitive types

```typescript
booleans(); // true or false
integers(minValue?, maxValue?); // integer numbers
floats(minValue?, maxValue?); // floating-point numbers
text(minSize?, maxSize?); // Unicode strings
binary(minSize?, maxSize?); // Uint8Array byte arrays
```

### Constants and choices

```typescript
just(value); // always returns the same value
sampledFrom([a, b, c]); // picks from an array of values
```

### Collections

```typescript
lists(elements, minSize?, maxSize?); // arrays of generated elements
tuples2(gen1, gen2); // [T1, T2] tuple
tuples3(gen1, gen2, gen3); // [T1, T2, T3] tuple
tuples4(gen1, gen2, gen3, gen4); // [T1, T2, T3, T4] tuple
dicts(keys, values, minSize?, maxSize?); // Map<K, V>
```

### Combinators

```typescript
oneOf(gen1, gen2, ...); // values from any of the given generators
optional(gen); // a generated value or null
gen.map(f); // transform generated values
gen.filter(predicate); // keep only values matching a condition
gen.flatMap(f); // chain generators where output depends on input
```

### Formats and patterns

```typescript
fromRegex(pattern); // strings matching a regular expression
emails(); // email addresses
urls(); // URLs
domains(); // domain names
dates(); // ISO date strings
times(); // ISO time strings
datetimes(); // ISO datetime strings
ipAddresses(); // IP addresses (v4 or v6)
```

## Type-directed derivation

For complex domain types, Hegel supports automatic generator derivation.

### Class-based derivation with `@field`

Requires `"experimentalDecorators": true` in `tsconfig.json`.

```typescript
import { field, deriveGenerator, integers, text, booleans } from "hegel-typescript";

class User {
  @field(text(1, 50))
  name!: string;

  @field(integers(18, 120))
  age!: number;

  @field(booleans())
  active!: boolean;
}

const userGen = deriveGenerator(User);
// await userGen.generate() returns a User instance with random fields
```

### Plain-object records with `recordGenerator`

No class or decorators needed:

```typescript
import { recordGenerator, floats } from "hegel-typescript";

const pointGen = recordGenerator({
  x: floats(-100, 100),
  y: floats(-100, 100),
});
// await pointGen.generate() returns { x: number, y: number }
```

### Discriminated unions with `variantGenerator`

```typescript
import { variantGenerator, recordGenerator, floats } from "hegel-typescript";

type Shape =
  | { type: "circle"; radius: number }
  | { type: "rectangle"; width: number; height: number }
  | { type: "point" };

const shapeGen = variantGenerator<Shape>({
  circle: recordGenerator({ radius: floats(0.1, 100) }),
  rectangle: recordGenerator({
    width: floats(0.1, 100),
    height: floats(0.1, 100),
  }),
  point: null,
});
// await shapeGen.generate() returns one of the Shape variants
```

## Debugging with `note()`

Use `note()` to print debug information. Messages only appear when Hegel replays
the minimal failing example:

```typescript
import { runHegelTest, integers, note } from "hegel-typescript";

it("debugging example", async () => {
  await runHegelTest(async () => {
    const x = await integers().generate();
    const y = await integers().generate();
    note(`trying x=${x}, y=${y}`);
    expect(x + y).toBe(y + x); // commutativity — always true
  });
});
```

## Guiding generation with `target()`

Use `target()` to guide Hegel toward interesting values, making it more likely to
find boundary failures:

```typescript
import { runHegelTest, integers, target } from "hegel-typescript";

it("seek large values", async () => {
  await runHegelTest(
    async () => {
      const x = await integers(0, 10000).generate();
      target(x, "maximize_x");
      expect(x).toBeLessThanOrEqual(9999); // this will fail!
    },
    { testCases: 1000 },
  );
});
```

`target()` is advisory — Hegel will try to maximize the targeted metric, but it
may still explore other regions of the input space.

## Next steps

- Build the API reference with `just docs`, then open `docs/index.html`.
- Browse the [`examples/`](../examples/) directory for runnable programs.
