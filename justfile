set ignore-comments := true

# Download the host's published libhegel artifact into native/ (if missing)
# and print its path. Used to run tests against the real native library. (End
# users instead get the library from the @hegeldev/hegel-<os>-<arch> platform
# packages; see scripts/make-platform-packages.mjs.)
@fetch-libhegel:
    node scripts/fetch-libhegel.mjs

# Build libhegel from a sibling ../hegel-rust checkout (for local development
# against an unreleased engine). Prints the path to export as
# HEGEL_LIBHEGEL_PATH.
build-libhegel:
    #!/usr/bin/env bash
    set -euo pipefail
    cargo build --release -p hegeltest-c --manifest-path ../hegel-rust/Cargo.toml
    echo "../hegel-rust/target/release/libhegel_c.so"

# Regenerate src/libhegel-version.ts from a hegel-rust release. Targets the
# latest release; pass a version (e.g. `just update-libhegel 0.20.1`) to pin an
# exact one.
update-libhegel version="":
    node scripts/update-libhegel.mjs {{version}}
    npx prettier --write src/libhegel-version.ts

check-test:
    #!/usr/bin/env bash
    set -euo pipefail
    export HEGEL_LIBHEGEL_PATH="${HEGEL_LIBHEGEL_PATH:-$(node scripts/fetch-libhegel.mjs)}"
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

# these aliases are provided as ux improvements for local developers. CI should use the longer
# forms.
test: check-test
lint: check-format check-lint
check: lint check-docs check-test
