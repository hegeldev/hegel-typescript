# Hegel TypeScript SDK

Hegel TypeScript SDK.

## Installation

```bash
npm install git+ssh://git@github.com/antithesishq/hegel-typescript.git
```

## Quick Start

```typescript
import { hegel, integers, text, arrays, assume, note } from "@antithesishq/hegel-typescript";

await hegel(() => {
  // Generate random values
  const num = integers().min(0).max(100).generate();
  const str = text().maxSize(50).generate();
  const arr = arrays(integers()).minSize(1).maxSize(10).generate();

  // Skip test cases that don't meet preconditions
  assume(num > 0);

  // Log debugging information (only shown on final replay)
  note(`Testing with value: ${num}`);

  // Your test assertions here
  if (arr.length === 0) {
    throw new Error("Array should not be empty");
  }
});
```

## Configuration

Use the `Hegel` builder for more control:

```typescript
import { Hegel, Verbosity, integers } from "@antithesishq/hegel-typescript";

await new Hegel(() => {
  const x = integers().generate();
  // test logic
})
  .testCases(200)              // Run 200 test cases (default: 100)
  .verbosity(Verbosity.Debug)  // Show debug output
  .run();
```

## API Documentation

Builds docs with:

```bash
just docs
```

## Environment Variables

- `HEGEL_DEBUG`: If set to `1` or `true`, prints request/response JSON to stderr
