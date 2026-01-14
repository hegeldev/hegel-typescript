# Hegel TypeScript SDK

A TypeScript SDK for Hegel property-based testing. This SDK allows TypeScript/Node.js test binaries to communicate with the Hegel server to generate random test data according to JSON schemas.

## Prerequisites

This SDK requires the `hegel` CLI tool to be installed. Install it via pip:

```bash
pip install git+ssh://git@github.com/antithesishq/hegel.git
```

Verify installation:

```bash
hegel --version
```

## Requirements

- Node.js >= 18.0.0
- Hegel CLI installed (see Prerequisites)

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
import {
  integers,
  text,
  arrays,
  sampledFrom,
  reject,
  note,
} from "@antithesishq/hegel-typescript";

// Generate random values
const num = integers().min(0).max(100).generate();
const str = text().maxSize(50).generate();
const arr = arrays(integers()).minSize(1).maxSize(10).generate();

// Use sampledFrom for test selection
const testName = sampledFrom(["test1", "test2", "test3"]).generate();

// Reject invalid test cases
if (someCondition) {
  reject("Invalid test case");
}

// Log debugging information
note(`Testing with value: ${num}`);
```

## Running with Hegel

Tests are executed via the `hegel` command:

```bash
hegel node dist/my-test.js --test-cases=100
```

## Environment Variables

- `HEGEL_SOCKET`: Path to the Unix socket for generation requests (set by hegel)
- `HEGEL_REJECT_CODE`: Exit code to signal test case rejection (set by hegel)
- `HEGEL_DEBUG`: If set, prints request/response JSON to stderr

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
integers();                           // Full range
integers().min(0).max(100);          // Constrained range

// Floats with fluent configuration
floats();                             // Any float
floats().min(0.0).max(1.0);          // Constrained
floats().excludeMin().excludeMax();  // Exclusive bounds
```

### String Generators

```typescript
text();                              // Any string
text().minSize(1).maxSize(100);     // Constrained length
fromRegex("[a-z]{3}-[0-9]{3}");     // Matches pattern
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

// Maps (keys are always strings)
maps(integers());                                // Map<string, number>
maps(text()).minSize(1).maxSize(5);             // Constrained size

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

### Rejection

When generated data doesn't meet preconditions that can't be expressed in the schema:

```typescript
import { reject } from "@antithesishq/hegel-typescript";

const data = makeGenerator().generate();

if (!isValidPrecondition(data)) {
  reject("input doesn't satisfy precondition");
}

// Test logic here
```

## Exit Codes

- `0`: Test passed
- `HEGEL_REJECT_CODE`: Test case rejected (try different input)
- `1`: Test assertion failed
