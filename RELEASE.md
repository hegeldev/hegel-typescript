RELEASE_TYPE: minor

This release adds browser support through the existing `@hegeldev/hegel` imports. Browser builds initialize the packaged Rust Wasm engine automatically, while Node continues to use the native engine.

It also changes generated time and datetime strings with nonzero fractional seconds from six to nine digits, preserving nanosecond precision. Browser test settings reject filesystem database paths.
