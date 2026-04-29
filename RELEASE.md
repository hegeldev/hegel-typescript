RELEASE_TYPE: minor

Bump our pinned hegel-core to [0.5.0](https://github.com/hegeldev/hegel-core/releases/tag/v0.5.0). `oneOf` and `optional` no longer wrap their child schemas in `[constant(i), child]` tagged tuples; they now rely on the new protocol contract where the server emits `[index, value]` for `one_of` schemas, dispatching the per-branch transform internally.
