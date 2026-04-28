RELEASE_TYPE: patch

Bump our pinned `hegel-core` version from `0.4.0` to [`0.4.14`](https://github.com/hegeldev/hegel-core/releases/tag/v0.4.14). Notable `hegel-core` changes since `0.4.0`:

- [v0.4.2](https://github.com/hegeldev/hegel-core/releases/tag/v0.4.2): Added `crash_after_handshake` and `crash_after_handshake_with_stderr` test modes for exercising client crash detection.
- [v0.4.3](https://github.com/hegeldev/hegel-core/releases/tag/v0.4.3): Added `OneOfConformance` and recommended integer bound constants (`INT32_MIN`/`MAX`, `INT64_MIN`/`MAX`, `BIGINT_MIN`/`MAX`) for conformance setup.
- [v0.4.4](https://github.com/hegeldev/hegel-core/releases/tag/v0.4.4): Conformance fixes for Windows compatibility.
- [v0.4.5](https://github.com/hegeldev/hegel-core/releases/tag/v0.4.5): Added `OriginDeduplicationConformance`.
- [v0.4.6](https://github.com/hegeldev/hegel-core/releases/tag/v0.4.6): Fixed several concurrency bugs and improved protocol-layer error handling on the server. Clients that make protocol mistakes now receive a clear `ProtocolError` reply instead of the server silently dying.
- [v0.4.7](https://github.com/hegeldev/hegel-core/releases/tag/v0.4.7): Added a `single_test_case` top-level protocol command for one-shot test-case generation without shrinking or replay.
- [v0.4.8](https://github.com/hegeldev/hegel-core/releases/tag/v0.4.8): Removed the unused Unix-socket transport from the server. The server now always communicates over stdin/stdout, and the `--stdio` flag has been dropped — we no longer pass it when spawning the server.
- [v0.4.9](https://github.com/hegeldev/hegel-core/releases/tag/v0.4.9): Added a `command_prefix` argument to `run_conformance_tests`.
- [v0.4.10](https://github.com/hegeldev/hegel-core/releases/tag/v0.4.10): Added fraction and complex-number schema types.
- [v0.4.11](https://github.com/hegeldev/hegel-core/releases/tag/v0.4.11): Added a `skip_unique` parameter to `ListConformance`.
- [v0.4.12](https://github.com/hegeldev/hegel-core/releases/tag/v0.4.12): Removed CBOR tagging from fraction and complex numbers.
- [v0.4.14](https://github.com/hegeldev/hegel-core/releases/tag/v0.4.14): Pinned `hegel-core`'s dependencies below their next major versions.

The protocol version is unchanged at `0.10`.

This PR also adds a `hegel-core-release` `repository_dispatch` receiver workflow (`.github/workflows/bump-hegel-core.yml`) so that future `hegel-core` releases automatically open a PR here bumping the pinned version.
