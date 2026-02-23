# Hegel SDK for TypeScript

## Tools & Versions

- **Runtime**: Node.js 22 LTS
- **Language**: TypeScript 5.x
- **Package Manager**: npm
- **Test Framework**: Vitest 4.x with @vitest/coverage-v8
- **Linter**: ESLint 10.x with typescript-eslint
- **Formatter**: Prettier 3.x
- **Documentation**: TypeDoc 0.28.x
- **Coverage**: V8 provider via Vitest, enforced at 100%

## Build Commands

```bash
just setup   # Install npm dependencies + hegel binary into .venv
just test    # Run tests with 100% coverage enforcement
just format  # Auto-format code with Prettier
just lint    # Type-check (tsc) + ESLint + Prettier check
just docs    # Generate API docs with TypeDoc
just check   # Run lint + docs + test (full CI check)
```

## Project Conventions

- **Source code** lives in `src/`
- **Tests** live in `tests/`, one file per module (e.g., `tests/index.test.ts`)
- **ESM-only**: The project uses ES modules (`"type": "module"` in package.json)
- **Strict TypeScript**: All strict checks enabled in tsconfig.json
- **100% code coverage**: Vitest enforces 100% line/branch/function/statement coverage. The `scripts/check-coverage.py` script provides an additional check with false-positive filtering.
- **Formatting**: Prettier with double quotes, semicolons, trailing commas
- **Linting**: ESLint 9 flat config with typescript-eslint recommended rules
- **Tests use PATH**: Test recipe prepends `.venv/bin` to PATH so `hegel` binary is found

## Project Structure

```
src/           # Library source code
tests/         # Test files (*.test.ts)
scripts/       # Build/CI helper scripts
dist/          # Compiled output (gitignored)
docs/          # Generated API docs (gitignored)
coverage/      # Coverage reports (gitignored)
```
