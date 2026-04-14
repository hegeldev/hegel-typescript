# Changelog

## 0.3.0 - 2026-04-14

Complete rewrite of the library based on `hegel-rust` architecture. Synchronous stdio-based I/O, explicit `TestCase` parameter, options-object generators, `DataSource` abstraction, `record()` combinator, and dual-path conformance testing via `makeNonBasic`.

## 0.2.5 - 2026-04-10

Update to new protocol version.

## 0.2.4 - 2026-03-11

Add validation to generator arguments.

## 0.2.3 - 2026-03-04

Reorganize generators, and rename package from `hegel-typescript` to `hegel`.

## 0.2.2 - 2026-03-04

Remove some unnecessary code only present for testing.

## 0.2.1 - 2026-03-03

Replace `gen.generate()` with `draw(gen)`.

## 0.2.0 - 2026-02-27

Complete rewrite with full protocol implementation,
generator combinators, type-directed derivation (decorators, records, variants),
conformance tests, and getting-started documentation. Adds release automation.
