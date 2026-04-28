RELEASE_TYPE: minor

`oneOf` and `optional` no longer wrap their child schemas in `[constant(i), child]` tagged tuples. They now rely on the new protocol contract where the server emits `[index, value]` for `one_of` schemas, dispatching the per-branch transform internally. Requires the matching `hegel` server release that ships this protocol change.
