# Hegel TypeScript SDK

Hegel TypeScript SDK.

## Installation

```bash
npm install git+ssh://git@github.com/antithesishq/hegel-typescript.git
```

## Quick Start

```typescript
import { runHegelTest, generateFromSchema, assume, note } from "@antithesishq/hegel-typescript";

await runHegelTest(async function myTest() {
  const x = await generateFromSchema({ type: "integer", min_value: 0, max_value: 100 });

  // Skip test cases that don't meet preconditions
  assume(typeof x === "number" && x >= 0);

  // Log debugging information (only shown on final replay)
  note(`Testing with value: ${x}`);

  // Your test assertions here
  if (x > 100) {
    throw new Error("Value out of range");
  }
});
```

## Configuration

Use `runHegelTest` options for more control:

```typescript
import { runHegelTest, generateFromSchema } from "@antithesishq/hegel-typescript";

await runHegelTest(
  async function myTest() {
    const x = await generateFromSchema({ type: "integer" });
    // test logic
  },
  { testCases: 200 }, // Run 200 test cases (default: 100)
);
```

## API Documentation

Build docs with:

```bash
just docs
```
