RELEASE_TYPE: minor

Complete rewrite of the library based on `hegel-rust` architecture. Introduces synchronous `DataSource` abstraction, `TestCase`-based API with `draw()`/`assume()`/`target()`/`note()`, collection protocol support for composite generators, type-directed derivation via `recordGenerator`/`variantGenerator`/`@field` decorator, and conformance test infrastructure.
