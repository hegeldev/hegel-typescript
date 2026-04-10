set ignore-comments := true

# Install dependencies and the hegel binary.
# If HEGEL_BINARY is set, symlinks it into .venv/bin instead of installing from PyPI.
setup:
    #!/usr/bin/env bash
    set -euo pipefail
    uv venv .venv
    if [ -n "${HEGEL_BINARY:-}" ]; then
        mkdir -p .venv/bin
        ln -sf "$HEGEL_BINARY" .venv/bin/hegel
    else
        uv pip install --python .venv/bin/python hegel-core
    fi
    npm install

check-test:
    #!/usr/bin/env bash
    set -euo pipefail
    export PATH=".venv/bin:$PATH"
    npx vitest run --coverage
    python3 scripts/check-coverage.py

format:
    npx prettier --write .

check-format:
    npx prettier --check .

check-lint:
    npx eslint .
    npx tsc --noEmit

check-docs:
    npx typedoc

docs:
    npx typedoc
    open docs/index.html

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

check-conformance: build-conformance
    uv run --with 'hegel-core==0.3.2' --with pytest --with hypothesis \
        pytest tests/conformance/ -v

# these aliases are provided as ux improvements for local developers. CI should use the longer
# forms.
test: check-test
lint: check-format check-lint
conformance: check-conformance
check: lint check-docs check-test
