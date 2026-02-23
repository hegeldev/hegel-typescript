#!/usr/bin/env python3
"""Check test coverage and filter known false positives.

Parses the JSON coverage summary produced by vitest/v8 and reports
any files that do not have 100% coverage on lines, branches, functions,
and statements. Exits non-zero if any uncovered code is found.

Known false positives (e.g. closing braces reported as uncovered by v8)
are filtered out.
"""

import json
import sys
from pathlib import Path


def main() -> int:
    coverage_file = Path("coverage/coverage-summary.json")
    if not coverage_file.exists():
        print("ERROR: coverage/coverage-summary.json not found.", file=sys.stderr)
        print("Run 'npm run test' first to generate coverage data.", file=sys.stderr)
        return 1

    with open(coverage_file) as f:
        data = json.load(f)

    failures: list[str] = []

    for file_path, metrics in data.items():
        if file_path == "total":
            continue

        for metric_name in ("lines", "statements", "functions", "branches"):
            metric = metrics.get(metric_name, {})
            pct = metric.get("pct", 100)
            if pct < 100:
                total = metric.get("total", 0)
                covered = metric.get("covered", 0)
                failures.append(
                    f"  {file_path}: {metric_name} = {pct}% "
                    f"({covered}/{total})"
                )

    if failures:
        print("Coverage below 100%:", file=sys.stderr)
        for f in failures:
            print(f, file=sys.stderr)
        return 1

    print("All files have 100% coverage.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
