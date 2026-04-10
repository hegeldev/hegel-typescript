"""Conformance tests for Hegel for TypeScript.

These tests validate that Hegel for TypeScript correctly implements the Hegel
protocol by running compiled TypeScript binaries against the real hegel server
and checking that the generated values satisfy the expected constraints.

The conformance binaries are compiled by `just build-conformance` to
`bin/conformance/` as executable Node.js scripts.
"""

from pathlib import Path

import pytest
from hegel.conformance import (
    BinaryConformance,
    BooleanConformance,
    DictConformance,
    EmptyTestConformance,
    ErrorResponseConformance,
    FloatConformance,
    IntegerConformance,
    ListConformance,
    SampledFromConformance,
    StopTestOnCollectionMoreConformance,
    StopTestOnGenerateConformance,
    StopTestOnMarkCompleteConformance,
    StopTestOnNewCollectionConformance,
    TextConformance,
    run_conformance_tests,
)

# Path to the compiled conformance binaries.
# The justfile compiles them to bin/conformance/ before running tests.
BINARIES_DIR = Path(__file__).parent.parent.parent / "bin" / "conformance"


def _bin(name: str) -> Path:
    """Return the path to a conformance binary."""
    return BINARIES_DIR / name


@pytest.fixture
def conformance_tests() -> list:
    """Return all conformance test instances."""
    return [
        BooleanConformance(_bin("test_booleans")),
        IntegerConformance(_bin("test_integers"), min_value=-1000, max_value=1000),
        FloatConformance(_bin("test_floats")),
        TextConformance(_bin("test_text")),
        BinaryConformance(_bin("test_binary")),
        ListConformance(_bin("test_lists"), min_value=-1000, max_value=1000),
        SampledFromConformance(_bin("test_sampled_from")),
        DictConformance(_bin("test_hashmaps")),
        StopTestOnGenerateConformance(_bin("test_booleans")),
        StopTestOnMarkCompleteConformance(_bin("test_booleans")),
        StopTestOnCollectionMoreConformance(_bin("test_lists")),
        StopTestOnNewCollectionConformance(_bin("test_lists")),
        ErrorResponseConformance(_bin("test_booleans")),
        EmptyTestConformance(_bin("test_booleans")),
    ]


def test_conformance(conformance_tests: list, subtests: pytest.Subtests) -> None:
    """Run all conformance tests for Hegel for TypeScript."""
    run_conformance_tests(conformance_tests, subtests)
