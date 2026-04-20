/**
 * Generator system: re-exports all generators, combinators, and types.
 *
 * @packageDocumentation
 */

export { Generator, BasicGenerator } from "./core.js";
export { integers, bigIntegers, floats, booleans } from "./numeric.js";
export type { IntegerOptions, BigIntegerOptions, FloatOptions } from "./numeric.js";
export { text, characters, binary, fromRegex } from "./strings.js";
export { emails, urls, domains, ipAddresses } from "./strings.js";
export { dates, times, datetimes } from "./strings.js";
export type {
  CharacterFilterOptions,
  TextOptions,
  CharacterOptions,
  BinaryOptions,
  RegexOptions,
  DomainOptions,
  IpAddressOptions,
} from "./strings.js";

export { arrays, sets, maps } from "./collections.js";
export type { CollectionOptions, ArrayOptions } from "./collections.js";
export { just, sampledFrom, oneOf, optional } from "./combinators.js";
export { tuples } from "./tuples.js";
export { composite, record } from "./compose.js";
