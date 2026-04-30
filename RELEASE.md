RELEASE_TYPE: patch

Update the wire schemas emitted for `optional()` and `ipAddresses()` to track
the corresponding cleanup in `hegel-core`. `optional(g)` now emits
`{type: "constant", value: null}` instead of `{type: "null"}` for its null
branch, and `ipAddresses({version})` now emits
`{type: "ip_addresses", version}` instead of `{type: "ipv4"}` /
`{type: "ipv6"}`. The public TypeScript API is unchanged.
