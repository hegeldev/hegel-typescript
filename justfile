# Hegel SDK for typescript
# This justfile provides the standard build recipes.

# Install dependencies and the hegel binary.
# If HEGEL_BINARY is set, symlinks it into .venv/bin instead of installing from git.
setup:
    #!/usr/bin/env bash
    set -euo pipefail
    uv venv .venv
    if [ -n "${HEGEL_BINARY:-}" ]; then
        mkdir -p .venv/bin
        ln -sf "$HEGEL_BINARY" .venv/bin/hegel
    else
        uv pip install --python .venv/bin/python hegel@git+ssh://git@github.com/antithesishq/hegel-core.git
    fi
    npm ci

# Run tests with coverage enforcement. Fails if coverage drops below 100%.
test:
    #!/usr/bin/env bash
    set -euo pipefail
    export PATH=".venv/bin:$PATH"
    npx vitest run --coverage
    python3 scripts/check-coverage.py

# Auto-format code.
format:
    npx prettier --write src/ tests/

# Check formatting + linting.
lint:
    #!/usr/bin/env bash
    set -euo pipefail
    npx tsc --noEmit
    npx eslint src/ tests/
    npx prettier --check src/ tests/

# Build API documentation from source. Must succeed with zero warnings.
docs:
    npx typedoc

# Run lint + docs + test (the full CI check).
check: lint docs test
