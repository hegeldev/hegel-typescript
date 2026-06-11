RELEASE_TYPE: patch

Fix a hang when a property test uses inconsistent data generation (for example, conditional `tc.draw()` calls on external state). The client now reports the server's flaky-strategy error instead of blocking forever. See https://github.com/hegeldev/hegel-typescript/issues/48.
