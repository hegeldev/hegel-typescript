/**
 * Generator system: re-exports all generators, combinators, and types.
 *
 * @packageDocumentation
 */

// Core
export { Generator, BasicGenerator } from "./core.js";

// Numeric & boolean
export { integers, bigIntegers, floats, booleans } from "./numeric.js";
export type { IntegerOptions, BigIntegerOptions, FloatOptions } from "./numeric.js";

// Strings, characters, binary, regex, formats
export { text, characters, binary, fromRegex } from "./strings.js";
export { emails, urls, domains, ipv4Addresses, ipv6Addresses, ipAddresses } from "./strings.js";
export { dates, times, datetimes } from "./strings.js";
export type {
  CharacterFilterOptions,
  TextOptions,
  CharacterOptions,
  BinaryOptions,
  RegexOptions,
  DomainOptions,
} from "./strings.js";

// Collections
export { arrays, lists, sets, maps, dicts } from "./collections.js";
export type { CollectionOptions, ArrayOptions } from "./collections.js";

// Combinators
export { just, sampledFrom, oneOf, optional } from "./combinators.js";

// Tuples
export { tuples, tuples3, tuples4 } from "./tuples.js";

// Composition
export { composite, record } from "./compose.js";

// Re-export StopTestError for use in generators
export { StopTestError } from "../testCase.js";
