/**
 * Hegel property-based testing SDK for TypeScript.
 *
 * @packageDocumentation
 */

/** Returns the version of the Hegel TypeScript SDK. */
export function version(): string {
  return "0.1.0";
}

// Error classes
export {
  AssumeRejected,
  AssertionError,
  ConnectionError,
  DataExhausted,
  RuntimeError,
} from "./runner.js";

// Test entry points
export { runHegelTest, hegel, HegelSession } from "./session.js";

// Test helpers
export { assume, note, target, startSpan, stopSpan } from "./runner.js";

// Generators
export {
  Generator,
  BasicGenerator,
  Collection,
  group,
  discardableGroup,
  integers,
  floats,
  booleans,
  text,
  binary,
  just,
  sampledFrom,
  fromRegex,
  emails,
  urls,
  domains,
  dates,
  times,
  datetimes,
  lists,
  tuples2,
  tuples3,
  tuples4,
  oneOf,
  optional,
  ipAddresses,
  dicts,
} from "./generators.js";

// Type-directed derivation
export {
  field,
  DerivedGenerator,
  deriveGenerator,
  RecordDerivedGenerator,
  recordGenerator,
  VariantGenerator,
  variantGenerator,
} from "./derive.js";

export type { VariantDef, FieldMeta } from "./derive.js";

// Conformance testing
export { getTestCases, writeMetrics } from "./conformance.js";
