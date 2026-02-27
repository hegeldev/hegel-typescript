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
    npm install

# Run tests with coverage enforcement (100% required).
test:
    #!/usr/bin/env bash
    set -euo pipefail
    export PATH=".venv/bin:$PATH"
    npx vitest run --coverage
    python3 scripts/check-coverage.py

# Auto-format code.
format:
    npx prettier --write .

# Check formatting + linting.
lint:
    npx prettier --check .
    npx eslint .
    npx tsc --noEmit

# Build API documentation from source.
docs:
    npx typedoc

# Compile conformance test binaries to bin/conformance/.
# Each binary is an executable shell script that runs the TypeScript source via tsx.
build-conformance:
    #!/usr/bin/env bash
    set -euo pipefail
    REPO_ROOT="$(pwd)"
    mkdir -p bin/conformance
    for script in conformance/test_*.ts; do
        name=$(basename "$script" .ts)
        wrapper="bin/conformance/${name}"
        printf '#!/usr/bin/env bash\nexport PATH="%s/node_modules/.bin:$PATH"\nexec node --import tsx/esm "%s/conformance/%s.ts" "$@"\n' \
            "${REPO_ROOT}" "${REPO_ROOT}" "${name}" > "$wrapper"
        chmod +x "$wrapper"
    done
    echo "Conformance wrappers written to bin/conformance/"

# Run conformance tests against the real hegel server.
conformance: build-conformance
    #!/usr/bin/env bash
    set -euo pipefail
    export PATH=".venv/bin:$PATH"
    uv pip install --python .venv/bin/python pytest pytest-subtests hypothesis > /dev/null 2>&1 || true
    .venv/bin/python -m pytest tests/conformance/ -v

# Run lint + docs + test (the full CI check).
check: lint docs test
