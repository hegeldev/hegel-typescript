/**
 * Hegel TypeScript SDK
 *
 * A property-based testing SDK for TypeScript that communicates with the Hegel server.
 *
 * @example
 * ```typescript
 * import { integers, text, arrays, sampledFrom, reject, note } from "hegel-sdk";
 *
 * // Generate random values
 * const num = integers().min(0).max(100).generate();
 * const str = text().maxSize(50).generate();
 * const arr = arrays(integers()).minSize(1).maxSize(10).generate();
 *
 * // Use sampledFrom for test selection
 * const testName = sampledFrom(["test1", "test2", "test3"]).generate();
 *
 * // Reject invalid test cases
 * if (someCondition) {
 *   reject("Invalid test case");
 * }
 *
 * // Log debugging information
 * note(`Testing with value: ${num}`);
 * ```
 */

// Core types and utilities
export type { Generator, JsonSchema } from "./generator.js";
export { SchemaGenerator, FuncGenerator } from "./generator.js";
export { reject, note } from "./connection.js";
export { LABELS } from "./labels.js";
export type { Label } from "./labels.js";
export { group, discardableGroup, startSpan, stopSpan } from "./spans.js";

// Primitive generators
export { nulls, booleans, just } from "./primitives.js";

// Numeric generators
export { integers, IntegerGenerator } from "./integers.js";
export { floats, FloatGenerator } from "./floats.js";

// String generators
export { text, fromRegex, TextGenerator } from "./strings.js";

// Format string generators
export {
  emails,
  urls,
  domains,
  ipAddresses,
  dates,
  times,
  datetimes,
  DomainGenerator,
  IpAddressGenerator,
} from "./formats.js";

// Collection generators
export {
  arrays,
  sets,
  maps,
  tuples,
  ArrayGenerator,
  SetGenerator,
  MapGenerator,
} from "./collections.js";

// Combinators
export { sampledFrom, oneOf, optional } from "./combinators.js";

// Object generation
export { fixedObject, FixedObjectBuilder } from "./objects.js";
