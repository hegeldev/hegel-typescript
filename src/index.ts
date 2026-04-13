/**
 * Hegel property-based testing library for TypeScript.
 *
 * @packageDocumentation
 */

// Core types
export { TestCase, Collection, Labels, StopTestError, AssumeError } from "./testCase.js";
export type { GeneratorLike } from "./testCase.js";

// Runner
export { Hegel, hegel, Verbosity, HealthCheck, defaultSettings } from "./runner.js";
export type { Settings } from "./runner.js";

// Session
export { HegelSession, HEGEL_SERVER_VERSION } from "./session.js";

// Generators
export {
  Generator,
  BasicGenerator,
  // Primitives
  integers,
  floats,
  booleans,
  text,
  characters,
  binary,
  just,
  sampledFrom,
  fromRegex,
  // Collections
  arrays,
  lists,
  sets,
  maps,
  dicts,
  // Combinators
  oneOf,
  optional,
  tuples,
  tuples3,
  tuples4,
  // Format generators
  emails,
  urls,
  domains,
  ipAddresses,
  dates,
  times,
  datetimes,
  // Composition
  composite,
  recordGenerator,
  variantGenerator,
} from "./generators.js";

export type {
  IntegerOptions,
  FloatOptions,
  TextOptions,
  CharacterOptions,
  BinaryOptions,
  RegexOptions,
  CollectionOptions,
  ArrayOptions,
} from "./generators.js";

// Conformance testing
export { getTestCases, writeMetrics } from "./conformance.js";
