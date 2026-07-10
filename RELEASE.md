RELEASE_TYPE: patch

This patch fixes the `unique` and `minSize` contracts of collection
generators so that they are enforced on final (post-`.map()`) values.
Previously a mapped element generator kept its source's schema and applied
the map after generation, so the engine enforced uniqueness and minimum size
on the raw pre-map values: with a non-injective map,
`arrays(g.map(f), { unique: true })` could contain duplicate elements, and
`sets(g.map(f), { minSize: n })` / `maps(keys.map(f), values, { minSize: n })`
could come out smaller than `minSize` after deduplication. Collections now
detect elements or keys whose generator involves a `.map()` (including inside
`tuples`, `record`, `oneOf`, `optional`, or nested collections) and
deduplicate the final values instead, drawing more elements until the size
contract holds.

Collection generators now also use one consistent notion of equality when
deduplicating elements. Previously the non-schema (collection protocol) paths
disagreed: `arrays(..., { unique: true })` compared `JSON.stringify` output
(which equates `NaN` with `null` and all functions with each other, making
unique arrays of such values impossible to generate), while `sets` and `maps`
used reference equality (so a generated `Set` could contain many structurally
identical objects). All three now share a documented structural value-equality
helper: nested arrays/objects compare by contents, `NaN` equals `NaN`, `0`
equals `-0`, and functions compare by reference.

CI environments using Atlassian Bamboo are now detected correctly: CI
detection (which switches on `derandomize` and disables the example database)
checked for a `bamboo.buildKey` environment variable, but Bamboo exposes it as
`bamboo_buildKey`.

Documentation fixes: the Getting Started guide's examples now use the
post-0.2.0 `test("name", () => hegel.test(...))` form, `fromRegex` documents
its regex dialect (Python `re` syntax, passed to the engine verbatim) and the
`fullmatch` semantics (full match by default since 0.4.0; `fullmatch: false`
for contains-a-match behaviour), and the README shows the real failure output
format.
