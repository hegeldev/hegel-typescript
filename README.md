# Hegel TypeScript SDK

A TypeScript SDK for Hegel property-based testing. This SDK allows TypeScript/Node.js programs to generate random test data according to JSON schemas, powered by Hypothesis.

## Requirements

- Node.js >= 18.0.0
- Python 3.13+ (auto-installed if needed via uv)

The SDK will automatically install the `hegel` CLI if not found on PATH.

## Installation

```bash
npm install @antithesishq/hegel-typescript
```

Or for local development:

```bash
npm install /path/to/hegel-typescript
```

## Quick Start

```typescript
import { hegel, integers, text, arrays, assume, note } from "@antithesishq/hegel-typescript";

hegel(() => {
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

new Hegel(() => {
  const x = integers().generate();
  // test logic
})
  .testCases(200)              // Run 200 test cases (default: 100)
  .verbosity(Verbosity.Debug)  // Show debug output
  .run();
```

## Environment Variables

- `HEGEL_DEBUG`: If set to `1` or `true`, prints request/response JSON to stderr

## API Reference

### Primitive Generators

```typescript
nulls();              // Generates null
booleans();           // Generates true/false
just(value);          // Always returns the same value
```

### Numeric Generators

```typescript
// Integers with fluent configuration
integers();                           // Full safe integer range
integers().min(0).max(100);          // Constrained range

// Floats with fluent configuration
floats();                             // Any float
floats().min(0.0).max(1.0);          // Constrained
floats().excludeMin().excludeMax();  // Exclusive bounds
floats().allowNan().allowInfinity(); // Allow special values
```

### String Generators

```typescript
text();                              // Any string
text().minSize(1).maxSize(100);     // Constrained length
fromRegex("[a-z]{3}-[0-9]{3}");     // Matches pattern
```

### Binary Generator

```typescript
binary();                            // Random bytes as Uint8Array
binary({ minSize: 10, maxSize: 100 }); // Constrained size
```

### Format String Generators

```typescript
emails();                    // Email addresses
urls();                      // URLs
domains();                   // Domain names
domains().maxLength(50);     // Constrained domain length
ipAddresses();               // IPv4 or IPv6
ipAddresses().v4();          // IPv4 only
ipAddresses().v6();          // IPv6 only
dates();                     // ISO 8601 dates (YYYY-MM-DD)
times();                     // ISO 8601 times (HH:MM:SS)
datetimes();                 // ISO 8601 datetimes
```

### Collection Generators

```typescript
// Arrays
arrays(integers());                              // number[]
arrays(text()).minSize(1).maxSize(10);          // Constrained size
arrays(integers()).unique();                     // Unique elements

// Sets
sets(integers()).minSize(1).maxSize(5);         // Set<number>

// Maps
maps(text(), integers());                        // Map<string, number>
maps(text(), text()).minSize(1).maxSize(5);     // Constrained size

// Tuples
tuples(integers(), text(), booleans());         // [number, string, boolean]
```

### Combinators

```typescript
// Sample from fixed collection
sampledFrom(["apple", "banana", "cherry"]);

// Choose from multiple generators
oneOf(
  integers().min(0).max(10),
  integers().min(100).max(200)
);

// Optional values (null or value)
optional(integers());  // number | null
```

### Object Generation

```typescript
// Generate objects with specific fields
fixedObject()
  .field("name", text().minSize(1))
  .field("age", integers().min(0).max(120))
  .field("active", booleans())
  .build();
```

### Assumptions

When generated data doesn't meet preconditions that can't be expressed in the schema:

```typescript
import { hegel, integers, assume } from "@antithesishq/hegel-typescript";

hegel(() => {
  const x = integers().generate();
  const y = integers().generate();

  assume(y !== 0);  // Reject test cases where y is 0

  const result = x / y;
  // test logic here
});
```

### Notes

Print debugging information that only appears on the final replay run:

```typescript
import { hegel, integers, note } from "@antithesishq/hegel-typescript";

hegel(() => {
  const x = integers().generate();
  note(`Generated value: ${x}`);
  // test logic
});
```
