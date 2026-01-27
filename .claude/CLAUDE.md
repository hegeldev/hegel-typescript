# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the TypeScript SDK for Hegel, a universal property-based testing framework. The SDK provides a fluent API for generating random test data, which is powered by a Python server (Hypothesis) that communicates via Unix sockets.

## Build Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript (tsc)
npm run format       # Format with Prettier
```

## Architecture

### Embedded Mode (Primary Mode)

The TypeScript SDK runs in "embedded mode" where it inverts the typical client-server relationship:

1. **SDK creates Unix socket server** (`embedded.ts`) - listens for connections from the Hegel CLI
2. **SDK spawns hegel CLI** as subprocess with `--client-mode` flag
3. **For each test case**, hegel connects to the SDK's socket, sends a handshake, and the SDK runs the user's test function
4. **Generators request values** by sending JSON schemas to hegel and receiving generated data back
5. **Test results** (pass/fail/reject) are sent back to hegel over the socket

This is the reverse of the standalone SDKs (Go, Rust, C++) which connect to hegel's socket.

### Key Source Files

- `embedded.ts` - Socket server, hegel subprocess spawning, test loop
- `connection.ts` - Socket I/O, request/response handling, `assume()` and `note()` functions
- `generator.ts` - Core `Generator<T>` interface, `SchemaGenerator`, `FuncGenerator`, and combinator wrappers (`MappedGenerator`, `FlatMappedGenerator`, `FilteredGenerator`)
- `spans.ts` - Span management for shrinking (`startSpan`/`stopSpan`/`group`)
- `install.ts` - Auto-installation of hegel CLI via uv if not on PATH

### Generator Pattern

All generators implement the `Generator<T>` interface:
- `generate()` - Get a value
- `schema()` - Get JSON schema (or null if unavailable)
- `map()`, `flatMap()`, `filter()` - Combinators that invalidate schema

When `schema()` returns a valid schema, generation uses a single socket round-trip. When schema is null (after `map`/`flatMap`/`filter`), it falls back to compositional generation with multiple round-trips.

### Protocol Details

Wire format is newline-delimited JSON. Special value wrappers from the server:
- `{"$float": "nan"}` → `NaN`
- `{"$float": "inf"}` → `Infinity`
- `{"$integer": "..."}` → large integers as strings

## Code Style

- Prettier config: no semicolons, avoid parens on single arrow params, 88 char line width
- Use `.js` extension in imports (ES modules requirement)
- Builder pattern with immutable state for configurable generators (e.g., `integers().min(0).max(100)`)
