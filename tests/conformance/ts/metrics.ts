/**
 * Metrics utilities for conformance tests.
 */
import * as fs from "node:fs"

let metricsFile: number | null = null

function getMetricsFile(): number | null {
  if (metricsFile !== null) return metricsFile

  const path = process.env.CONFORMANCE_METRICS_FILE
  if (!path) return null

  metricsFile = fs.openSync(path, "a")
  return metricsFile
}

/**
 * Get the number of test cases to run from environment variable.
 */
export function getTestCases(): number {
  const val = process.env.CONFORMANCE_TEST_CASES
  if (val) {
    const n = parseInt(val, 10)
    if (!isNaN(n)) return n
  }
  return 50
}

/**
 * Get the params passed to the conformance test.
 */
export function getParams<T>(): T {
  const json = process.env.CONFORMANCE_PARAMS
  if (!json) {
    throw new Error("CONFORMANCE_PARAMS environment variable not set")
  }
  return JSON.parse(json) as T
}

/**
 * Write metrics as a JSON line to the metrics file.
 */
export function write(metrics: Record<string, unknown>): void {
  const fd = getMetricsFile()
  if (fd !== null) {
    const json = JSON.stringify(metrics)
    fs.writeSync(fd, json + "\n")
  }
}
