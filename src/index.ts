/**
 * Hegel property-based testing library for TypeScript.
 *
 * @packageDocumentation
 */

// Core types
export { TestCase, Collection, Labels, StopTestError, AssumeError } from "./testCase.js";
export type { GeneratorLike, DataSource } from "./testCase.js";

// Runner
export {
  Hegel,
  hegel,
  Verbosity,
  HealthCheck,
  defaultSettings,
  ServerDataSource,
  runTestCase,
} from "./runner.js";
export type { Settings, TestCaseResult, TestLocation } from "./runner.js";

// Protocol
export type { Packet } from "./protocol.js";

// Connection
export { Connection, Stream } from "./connection.js";

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
  ipv4Addresses,
  ipv6Addresses,
  ipAddresses,
  dates,
  times,
  datetimes,
  // Composition
  composite,
} from "./generators.js";

export type {
  IntegerOptions,
  FloatOptions,
  CharacterFilterOptions,
  TextOptions,
  CharacterOptions,
  BinaryOptions,
  RegexOptions,
  DomainOptions,
  CollectionOptions,
  ArrayOptions,
} from "./generators.js";

// Conformance testing
export { getTestCases, writeMetrics } from "./conformance.js";
