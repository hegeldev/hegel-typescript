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

### Hegel server

The SDK automatically manages the `hegel` server binary. On first use it
creates a project-local `.hegel/venv` virtualenv and installs the pinned
version of [hegel-core](https://github.com/antithesishq/hegel-core) into it.
Subsequent runs reuse the cached binary unless the pinned version changes.

To use your own `hegel` binary instead (e.g. a local development build), set
the `HEGEL_SERVER_COMMAND` environment variable:

```bash
export HEGEL_SERVER_COMMAND=/path/to/hegel
```

The SDK requires [`uv`](https://docs.astral.sh/uv/) to be installed for
automatic server management.

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
just setup   # Install npm dependencies
just check   # Full CI: lint + docs + tests with 100% coverage
just test    # Run tests only (auto-installs hegel on first run)
just format  # Auto-format code
```
