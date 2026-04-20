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
  Database,
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
  bigIntegers,
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
  sets,
  maps,
  // Combinators
  oneOf,
  optional,
  tuples,
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
  record,
} from "./generators/index.js";

export type {
  IntegerOptions,
  BigIntegerOptions,
  FloatOptions,
  CharacterFilterOptions,
  TextOptions,
  CharacterOptions,
  BinaryOptions,
  RegexOptions,
  DomainOptions,
  IpAddressOptions,
  CollectionOptions,
  ArrayOptions,
} from "./generators/index.js";
