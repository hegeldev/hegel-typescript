# hegel-typescript

A TypeScript SDK for [Hegel](https://github.com/antithesishq/hegel-core) —
universal property-based testing powered by
[Hypothesis](https://hypothesis.works/).

Hegel generates random inputs for your tests, finds failures, and automatically
shrinks them to minimal counterexamples.

## Installation

```bash
npm install "git+ssh://git@github.com/antithesishq/hegel-typescript.git"
```

The SDK requires the `hegel` CLI on your PATH:

```bash
pip install "hegel @ git+ssh://git@github.com/antithesishq/hegel-core.git"
```

## Quick Start

```typescript
import { runHegelTest, integers } from "hegel";

it("addition is commutative", async () => {
  await runHegelTest(async () => {
    const a = await integers().generate();
    const b = await integers().generate();
    expect(a + b).toBe(b + a);
  });
});
```

Run with your test runner (Vitest, Jest, etc.) as normal. Hegel generates 100
random input pairs and reports the minimal counterexample if it finds one.

For a full walkthrough, see [guide/getting-started.md](guide/getting-started.md).

## Development

```bash
just setup   # Install dependencies + hegel binary
just check   # Full CI: lint + docs + tests with 100% coverage
just test    # Run tests only
just format  # Auto-format code
```
