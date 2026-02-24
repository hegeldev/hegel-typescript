# Getting Started with Hegel (TypeScript)

## Install Hegel

Install the Python backend and the TypeScript SDK:

```bash
pip install hegel-sdk
npm install hegel-typescript
```

## Write your first test

Create `example.test.ts`:

```typescript
import { runHegelTest, integers } from "hegel-typescript";

it("integers are integers", async () => {
  await runHegelTest(async () => {
    const n = await integers().generate();
    console.log(`called with ${n}`);
    if (!Number.isInteger(n)) throw new Error(`Expected integer, got ${String(n)}`);
  });
});
```

> **TypeScript vs Python:** In Python, the `@hegel` decorator marks a function as a
> property-based test and you call it directly. In TypeScript, `runHegelTest` is a plain
> async function — wrap your test body in it. There is also a `hegel({ testCases })` factory
> function that returns a wrapper, useful for test frameworks that take a function argument.

`runHegelTest` runs the test body 100 times (by default) with different random inputs.
You call `.generate()` on generators inside the body to produce values. Running the test
produces different values on each case.

By default, Hegel generates 100 random inputs. Control this with the `testCases` option:

```typescript
await runHegelTest(async () => { ... }, { testCases: 500 });
```

## Running in a test suite

Hegel tests integrate with any test runner (Vitest, Jest, etc.):

```typescript
import { runHegelTest, integers } from "hegel-typescript";

it("bounded integers stay in range", async () => {
  await runHegelTest(async () => {
    const n = await integers(0, 49).generate();
    if (n >= 50) throw new Error(`${n} >= 50`);
  });
});
```

When a test fails, Hegel finds the smallest counterexample. For example, if the range
is `integers(0, 200)` and you assert `n < 50`, Hegel will shrink the failure to `n = 50`
— the minimal value that violates the property.

## Generating multiple values

Call `.generate()` multiple times to produce multiple values in a single test:

```typescript
import { runHegelTest, integers, text } from "hegel-typescript";

it("multiple generators work together", async () => {
  await runHegelTest(async () => {
    const n = await integers().generate();
    const s = await text().generate();
    if (!Number.isInteger(n)) throw new Error("n is not an integer");
    if (typeof s !== "string") throw new Error("s is not a string");
  });
});
```

> **TypeScript vs Python:** In Hypothesis (Python), strategies are passed as arguments
> to `@given` and received as function parameters. In Hegel (both Python and TypeScript),
> you call `.generate()` directly inside the test body. This means you can generate values
> at any point, including conditionally or in loops — no `@composite` decorator needed.

## Filtering

Use `.filter()` for simple conditions on generators:

```typescript
import { runHegelTest, integers } from "hegel-typescript";

it("even integers are even", async () => {
  await runHegelTest(async () => {
    const n = await integers()
      .filter((n) => n % 2 === 0)
      .generate();
    if (n % 2 !== 0) throw new Error(`${n} is not even`);
  });
});
```

For more complex conditions, use `assume()` inside the test body:

```typescript
import { runHegelTest, integers, assume } from "hegel-typescript";

it("Euclidean division identity", async () => {
  await runHegelTest(async () => {
    const n1 = await integers().generate();
    const n2 = await integers().generate();
    assume(n2 !== 0); // skip this test case if n2 is zero

    // n2 is guaranteed non-zero here
    const q = Math.trunc(n1 / n2);
    const r = n1 % n2;
    if (q * n2 + r !== n1) throw new Error(`Euclidean identity failed for ${n1} / ${n2}`);
  });
});
```

## Transforming generated values

Use `.map()` to transform values after generation:

```typescript
import { runHegelTest, integers } from "hegel-typescript";

it("stringified integers look like digits", async () => {
  await runHegelTest(async () => {
    const s = await integers(0, 100).map(String).generate();
    if (!/^\d+$/.test(s)) throw new Error(`"${s}" does not look like digits`);
  });
});
```

## Dependent generation

Since generation is imperative in Hegel, you can use earlier results to configure
later generators directly:

```typescript
import { runHegelTest, integers, lists } from "hegel-typescript";

it("index is always valid for the generated list", async () => {
  await runHegelTest(async () => {
    const n = await integers(1, 10).generate();
    const lst = await lists(integers(), { minSize: n, maxSize: n }).generate();
    const index = await integers(0, n - 1).generate();
    if (index < 0 || index >= lst.length)
      throw new Error(`index ${index} out of bounds for list of length ${lst.length}`);
  });
});
```

> **TypeScript vs Python:** In Hypothesis, dependent generation requires `@composite`
> or `data()`. In Hegel, it falls out naturally from the imperative `.generate()` style —
> just use the earlier value to configure the next generator.

You can also use `.flatMap()` for dependent generation within a single generator expression:

```typescript
import { runHegelTest, integers, lists } from "hegel-typescript";

it("flatMap dependent generation", async () => {
  await runHegelTest(async () => {
    const pair = await integers(1, 10)
      .flatMap((n) =>
        lists(integers(), { minSize: n, maxSize: n }).map((lst) => [lst, n - 1] as const),
      )
      .generate();
    const [lst, index] = pair;
    if (index < 0 || index >= lst.length) throw new Error(`index ${index} out of bounds`);
  });
});
```

## What you can generate

Hegel provides generators for all common data types.

### Primitive types

```typescript
booleans()                          // true or false
integers(minValue?, maxValue?)      // integer numbers
floats(minValue?, maxValue?)        // floating-point numbers
text(minSize?, maxSize?)            // Unicode strings
binary(minSize?, maxSize?)          // Uint8Array byte arrays
```

### Constants and choices

```typescript
just(value); // always returns the same value
sampledFrom([a, b, c]); // picks from an array of values
```

### Collections

```typescript
lists(elements, { minSize?, maxSize? })        // arrays of generated elements
tuples2(gen1, gen2)                            // [T1, T2] tuple
tuples3(gen1, gen2, gen3)                      // [T1, T2, T3] tuple
tuples4(gen1, gen2, gen3, gen4)                // [T1, T2, T3, T4] tuple
dicts(keys, values, { minSize?, maxSize? })    // Map<K, V>
```

### Combinators

```typescript
oneOf(gen1, gen2, ...)              // values from any of the given generators
optional(gen)                       // a generated value or null
gen.map(f)                          // transform generated values
gen.filter(predicate)               // keep only values matching a condition
gen.flatMap(f)                      // chain generators where output depends on input
```

### Specialized generators

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
  rectangle: recordGenerator({ width: floats(0.1, 100), height: floats(0.1, 100) }),
  point: null, // data-less variant
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
    // This assertion is always true, just for illustration:
    if (x + y !== y + x) throw new Error("addition is not commutative");
  });
});
```

## Guiding generation with `target()`

Use `target()` to guide Hegel toward interesting values:

```typescript
import { runHegelTest, floats, target } from "hegel-typescript";

it("optimization example", async () => {
  await runHegelTest(
    async () => {
      const x = await floats(0, 10000).generate();
      target(x, "maximize_x");
      if (x >= 9999) throw new Error(`x = ${x} is too large`);
    },
    { testCases: 1000 },
  );
});
```

Hegel will try to maximize the targeted value, making it more likely to find
boundary cases that violate your assertions.

## Next steps

- See the [API reference](index.html) for the full list of generators and options.
- Browse the [`examples/`](../examples/) directory for complete runnable programs.
- Read the [Hypothesis documentation](https://hypothesis.readthedocs.io/) for deeper
  background on property-based testing strategies.
