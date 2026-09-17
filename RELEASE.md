RELEASE_TYPE: patch

This patch bumps our pinned libhegel ([hegel-rust](https://github.com/hegeldev/hegel-rust)) from [0.32.5](https://github.com/hegeldev/hegel-rust/releases/tag/libhegel-v0.32.5) to [0.42.4](https://github.com/hegeldev/hegel-rust/releases/tag/libhegel-v0.42.4), and follows hegel-rust's new release tags: libhegel binaries now hang off `libhegel-v<version>` tags, so the fetch script, the bump workflow and the FFI alignment guide all use those.

Aligning to the new engine changes two things users can see:

- `times()` and `datetimes()` now draw with nanosecond precision. Values on a whole microsecond keep their previous `HH:MM:SS.ffffff` form; other values print all nine fractional digits.
- libhegel now resolves a default settings profile (from `HEGEL_DEFAULT_PROFILE` or a `hegel.toml`) when a run starts. If that fails — an unknown profile name, a malformed `hegel.toml` — `hegel.test` now throws the engine's diagnostic instead of crashing on a null handle.

It also fixes the mapping of the `Quiet` and `Normal` verbosity levels, which libhegel 0.42 renumbered.
