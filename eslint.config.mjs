import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // scripts/ holds standalone build/CI tooling (run via node/python), not part
  // of the library or test surface; tests/browser/ is the packed-package
  // browser fixture, the same kind of standalone Node script.
  { ignores: ["dist/", "docs/", "coverage/", "node_modules/", "scripts/", "tests/browser/"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
