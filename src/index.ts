/**
 * Hegel property-based testing SDK for TypeScript.
 *
 * @packageDocumentation
 */

/**
 * Returns the version string of the Hegel TypeScript SDK.
 *
 * @returns The current SDK version.
 */
export function version(): string {
  return "0.1.0";
}

// Re-export the public API
export {
  // Client-side helpers (use inside test bodies)
  assume,
  note,
  target,
  generateFromSchema,
  getChannel,
  startSpan,
  stopSpan,
  Collection,
  Labels,
  // Error classes
  AssumeRejected,
  DataExhausted,
  // Origin extraction (useful for custom error reporting)
  extractOrigin,
  // Client class (for advanced use)
  Client,
} from "./client.js";

export {
  // Session management
  HegelSession,
  findHegeld,
  // Primary public API
  runHegelTest,
  hegel,
  // Internal session (for testing)
  _session,
} from "./session.js";

export {
  // Connection primitives (for advanced use)
  Connection,
  Channel,
  RequestError,
  resultOrError,
  PendingRequest,
  SHUTDOWN,
} from "./connection.js";
