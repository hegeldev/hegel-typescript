RELEASE_TYPE: patch

Fix the getting-started examples, which passed the result of `hegel.test(...)` to `test` instead of a function. They now use `test("name", () => hegel.test(...))`.
