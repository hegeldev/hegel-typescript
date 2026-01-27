import {
  closeConnection,
  decrementSpanDepth,
  getSpanDepth,
  incrementSpanDepth,
  isConnected,
  openConnection,
  sendRequest,
} from "./connection.js"
import { Label } from "./labels.js"

/**
 * Start a labeled span for structural grouping.
 * Helps Hegel understand data structure for better shrinking.
 */
export function startSpan(label: Label): void {
  if (!isConnected()) {
    openConnection()
  }
  incrementSpanDepth()
  sendRequest("start_span", label)
}

/**
 * Stop the current span.
 * @param discard - If true, discard the data generated in this span (e.g., filtered value rejected)
 */
export function stopSpan(discard: boolean): void {
  sendRequest("stop_span", discard)
  decrementSpanDepth()
  if (getSpanDepth() === 0) {
    closeConnection()
  }
}

/**
 * Execute a function within a labeled span.
 * The span helps Hegel understand structure for shrinking.
 */
export function group<T>(label: Label, fn: () => T): T {
  startSpan(label)
  try {
    const result = fn()
    stopSpan(false)
    return result
  } catch (err) {
    stopSpan(true)
    throw err
  }
}

/**
 * Execute a function within a discardable span.
 * If the function returns null, the span is discarded.
 * Used for filtering where rejected values should be discarded.
 */
export function discardableGroup<T>(label: Label, fn: () => T | null): T | null {
  startSpan(label)
  try {
    const result = fn()
    stopSpan(result === null)
    return result
  } catch (err) {
    stopSpan(true)
    throw err
  }
}
