# hegel-typescript

**Property-based testing for TypeScript**, powered by [Hypothesis](https://hypothesis.readthedocs.io/) via the [Hegel](https://github.com/antithesishq/hegel-core) framework.

Hegel is a universal property-based testing framework. SDKs in each language communicate with a Python server (`hegel`) via Unix sockets using a binary protocol. This package is the TypeScript SDK.

## Installation

```bash
# Install the hegel binary (Python backend)
pip install hegel-sdk

# Install the TypeScript SDK
npm install hegel-typescript
```

## Quick Start

```typescript
import { runHegelTest, integers, text } from "hegel-typescript";

// In your test file (e.g. with Vitest or Jest):
it("addition is commutative", async () => {
  await runHegelTest(async () => {
    const a = await integers().generate();
    const b = await integers().generate();
    expect(a + b).toBe(b + a);
  });
});

it("string length is non-negative", async () => {
  await runHegelTest(async () => {
    const s = await text().generate();
    expect(s.length).toBeGreaterThanOrEqual(0);
  });
});
```

Hegel runs each test body 100 times (by default) with different random inputs,
and automatically shrinks any counterexample to the smallest failing case.

## How It Works

Inside a `runHegelTest` callback, you call `.generate()` on **generator** objects
to produce random values. Each call asks the Hegel server for a new value.
The server tracks what was generated and, if the test fails, replays a
minimal counterexample.

Unlike Hypothesis's `@given` decorator, Hegel uses an **imperative** style:
you generate values anywhere in the test body, including inside loops and
conditionals.

## Key API

### Running tests

```typescript
// Run a property test with the global session
await runHegelTest(async () => { ... }, { testCases: 200 });

// Decorator-factory style (wraps an async function)
it("my test", hegel({ testCases: 200 })(async () => { ... }));
```

### Primitive generators

```typescript
integers(minValue?, maxValue?)   // integer numbers
floats(minValue?, maxValue?)     // floating-point numbers
booleans()                       // true or false
text(minSize?, maxSize?)         // Unicode strings
binary(minSize?, maxSize?)       // Uint8Array / byte strings
```

### Collections

```typescript
lists(elements, minSize?, maxSize?)       // array of generated elements
dicts(keys, values, minSize?, maxSize?)   // object of key/value pairs
tuples2(gen1, gen2)                       // 2-tuple
tuples3(gen1, gen2, gen3)                 // 3-tuple
tuples4(gen1, gen2, gen3, gen4)           // 4-tuple
```

### Constants and combinators

```typescript
just(value); // always returns the same value
sampledFrom([a, b, c]); // pick from a list
oneOf(gen1, gen2, gen3); // pick from multiple generators
optional(gen); // value or null
```

### Generator combinators

```typescript
gen.map(f); // transform generated values
gen.filter(pred); // keep only values matching a condition
gen.flatMap(f); // dependent generation
```

### Filtering and assumptions

```typescript
// filter on the generator itself
const positives = integers().filter((n) => n > 0);

// or use assume() inside the test body
assume(condition); // skip this test case if false
```

### Debugging

```typescript
note("debug message"); // only shown on failure
target(value, "label"); // guide generation toward interesting values
```

### Type-directed derivation

```typescript
// Class-based (requires experimentalDecorators in tsconfig.json)
class User {
  @field(text(1, 50)) name!: string;
  @field(integers(18, 120)) age!: number;
}
const userGen = deriveGenerator(User);

// Plain-object records
const pointGen = recordGenerator({ x: floats(), y: floats() });

// Discriminated unions
const shapeGen = variantGenerator<Shape>({
  circle: recordGenerator({ radius: floats(0.1, 100) }),
  rectangle: recordGenerator({ width: floats(0.1, 100), height: floats(0.1, 100) }),
  point: null,
});
```

## Full API Reference

Run `just docs` to build the full API documentation:

```bash
just setup   # install dependencies
just docs    # generate docs in docs/
```

Then open `docs/index.html` in your browser.

A [Getting Started tutorial](guide/getting-started.md) is also available.

## Development

```bash
just setup   # install dependencies + hegel binary
just check   # run lint + docs + tests (full CI)
just test    # run tests only
just format  # auto-format code
```

## License

MIT — see [LICENSE](LICENSE).
