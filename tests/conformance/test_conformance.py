from pathlib import Path

from hegel.conformance import (
    BinaryConformance,
    BooleanConformance,
    DictConformance,
    FloatConformance,
    IntegerConformance,
    ListConformance,
    SampledFromConformance,
    TextConformance,
    run_conformance_tests,
)

BIN_DIR = Path(__file__).parent / "ts" / "bin"

# JavaScript numbers are IEEE 754 doubles, safe integer range is -(2^53-1) to 2^53-1
JS_MIN_SAFE_INTEGER = -(2**53 - 1)
JS_MAX_SAFE_INTEGER = 2**53 - 1


def test_conformance(subtests):
    run_conformance_tests(
        [
            BooleanConformance(BIN_DIR / "test_booleans"),
            IntegerConformance(
                BIN_DIR / "test_integers",
                min_value=JS_MIN_SAFE_INTEGER,
                max_value=JS_MAX_SAFE_INTEGER,
            ),
            FloatConformance(BIN_DIR / "test_floats"),
            TextConformance(BIN_DIR / "test_text"),
            BinaryConformance(BIN_DIR / "test_binary"),
            ListConformance(
                BIN_DIR / "test_lists",
                min_value=JS_MIN_SAFE_INTEGER,
                max_value=JS_MAX_SAFE_INTEGER,
            ),
            SampledFromConformance(BIN_DIR / "test_sampled_from"),
            DictConformance(
                BIN_DIR / "test_hashmaps",
                min_key=JS_MIN_SAFE_INTEGER,
                max_key=JS_MAX_SAFE_INTEGER,
                min_value=JS_MIN_SAFE_INTEGER,
                max_value=JS_MAX_SAFE_INTEGER,
            ),
        ],
        subtests,
    )
