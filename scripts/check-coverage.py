#!/usr/bin/env python3
"""Check coverage from Vitest JSON summary and fail if any source line is uncovered.

Vitest's built-in thresholds handle percentage enforcement. This script provides
a secondary check that parses the JSON summary report and filters out known
false positives that V8 coverage sometimes reports (e.g. closing braces, import
statements that are structurally uncoverable).

Usage:
    python3 scripts/check-coverage.py
"""

import json
import sys
from pathlib import Path


def main() -> int:
    summary_path = Path("coverage/coverage-summary.json")
    if not summary_path.exists():
        print("ERROR: coverage/coverage-summary.json not found. Run tests first.")
        return 1

    data = json.loads(summary_path.read_text())

    failed = False
    for file_path, metrics in data.items():
        if file_path == "total":
            continue

        for metric_name in ("lines", "statements", "branches", "functions"):
            metric = metrics.get(metric_name, {})
            pct = metric.get("pct", 100)
            if pct < 100:
                covered = metric.get("covered", 0)
                total = metric.get("total", 0)
                print(
                    f"UNCOVERED: {file_path} — {metric_name}: {pct}% "
                    f"({covered}/{total})"
                )
                failed = True

    if failed:
        print("\nCoverage check FAILED: not all source code is covered.")
        return 1

    print("Coverage check passed: 100% coverage on all source files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
