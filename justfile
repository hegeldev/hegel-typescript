set ignore-comments := true

check-test:
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
    uv run --with 'hegel-core==0.4.0' --with pytest --with hypothesis \
        pytest tests/conformance/ -v

# these aliases are provided as ux improvements for local developers. CI should use the longer
# forms.
test: check-test
lint: check-format check-lint
conformance: check-conformance
check: lint check-docs check-test
