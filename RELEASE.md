RELEASE_TYPE: patch

`sampledFrom` and the `categories` / `excludeCategories` options on `text` /
`characters` now accept `readonly` arrays. This lets callers pass a
`const`-asserted tuple (e.g. `["a", "b"] as const`) directly without a
`[...arr]` workaround.
