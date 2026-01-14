/**
 * Hegel Workout - Comprehensive test suite for the TypeScript SDK.
 *
 * This file tests all generator types and strategies.
 * Run with: npx tsx examples/hegel-workout.ts
 * (Requires HEGEL_SOCKET and HEGEL_REJECT_CODE environment variables)
 */

import {
  // Primitives
  nulls,
  booleans,
  just,
  // Numeric
  integers,
  floats,
  // Strings
  text,
  fromRegex,
  // Formats
  emails,
  urls,
  domains,
  ipAddresses,
  dates,
  times,
  datetimes,
  // Collections
  arrays,
  sets,
  maps,
  tuples,
  // Combinators
  sampledFrom,
  oneOf,
  optional,
  // Objects
  fixedObject,
  // Utilities
  note,
} from "../src/index.js";

/**
 * Test assertion helper.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAILED: ${message}`);
    process.exit(1);
  }
}

// ============================================================================
// Test functions
// ============================================================================

function testNulls(): void {
  const value = nulls().generate();
  assert(value === null, "nulls() must return null");
  console.log("nulls(): null");
}

function testBooleans(): void {
  const value = booleans().generate();
  assert(typeof value === "boolean", "booleans() must return boolean");
  console.log(`booleans(): ${value}`);
}

function testJust(): void {
  const value = just(42).generate();
  assert(value === 42, "just(42) must return 42");
  console.log(`just(42): ${value}`);
}

function testIntegersUnbounded(): void {
  const value = integers().generate();
  assert(typeof value === "number", "integers() must return number");
  assert(Number.isInteger(value), "integers() must return integer");
  console.log(`integers(): ${value}`);
}

function testIntegersBounded(): void {
  const value = integers().min(10).max(20).generate();
  assert(value >= 10 && value <= 20, "integers(10,20) must be in [10,20]");
  console.log(`integers(10,20): ${value}`);
}

function testFloatsUnbounded(): void {
  const value = floats().generate();
  assert(typeof value === "number", "floats() must return number");
  console.log(`floats(): ${value}`);
}

function testFloatsBounded(): void {
  const value = floats().min(0).max(1).generate();
  assert(value >= 0 && value <= 1, "floats(0,1) must be in [0,1]");
  console.log(`floats(0,1): ${value}`);
}

function testFloatsExclusive(): void {
  const value = floats().min(0).max(1).excludeMin().excludeMax().generate();
  assert(value > 0 && value < 1, "floats(0,1,exclusive) must be in (0,1)");
  console.log(`floats(0,1,exclusive): ${value}`);
}

function testText(): void {
  const value = text().generate();
  assert(typeof value === "string", "text() must return string");
  console.log(`text(): "${value.slice(0, 50)}${value.length > 50 ? "..." : ""}"`);
}

function testTextBounded(): void {
  const value = text().minSize(5).maxSize(10).generate();
  // Count codepoints, not UTF-16 code units (JSON Schema uses codepoints)
  const codepoints = [...value].length;
  assert(codepoints >= 5 && codepoints <= 10, `text(5,10) codepoint length must be in [5,10], got ${codepoints}`);
  console.log(`text(5,10): "${value}" (${codepoints} codepoints)`);
}

function testFromRegex(): void {
  const value = fromRegex("[a-z]+").generate();
  assert(/^[a-z]+$/.test(value), "fromRegex([a-z]+) must match pattern");
  console.log(`fromRegex([a-z]+): "${value}"`);
}

function testEmails(): void {
  const value = emails().generate();
  assert(value.includes("@"), "emails() must contain @");
  console.log(`emails(): "${value}"`);
}

function testUrls(): void {
  const value = urls().generate();
  assert(value.startsWith("http://") || value.startsWith("https://"), "urls() must start with http(s)://");
  console.log(`urls(): "${value}"`);
}

function testDomains(): void {
  const value = domains().maxLength(50).generate();
  assert(typeof value === "string" && value.length <= 50, "domains(50) length must be <= 50");
  console.log(`domains(50): "${value}"`);
}

function testIpAddressesV4(): void {
  const value = ipAddresses().v4().generate();
  assert(/^\d+\.\d+\.\d+\.\d+$/.test(value), "ipAddresses().v4() must be IPv4 format");
  console.log(`ipAddresses().v4(): "${value}"`);
}

function testIpAddressesV6(): void {
  const value = ipAddresses().v6().generate();
  assert(value.includes(":"), "ipAddresses().v6() must contain :");
  console.log(`ipAddresses().v6(): "${value}"`);
}

function testDates(): void {
  const value = dates().generate();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value), "dates() must be YYYY-MM-DD format");
  console.log(`dates(): "${value}"`);
}

function testTimes(): void {
  const value = times().generate();
  assert(value.includes(":"), "times() must contain :");
  console.log(`times(): "${value}"`);
}

function testDatetimes(): void {
  const value = datetimes().generate();
  assert(value.includes("T"), "datetimes() must contain T");
  console.log(`datetimes(): "${value}"`);
}

function testArrays(): void {
  const value = arrays(integers()).generate();
  assert(Array.isArray(value), "arrays() must return array");
  console.log(`arrays(integers()): [${value.slice(0, 5).join(", ")}${value.length > 5 ? ", ..." : ""}]`);
}

function testArraysBounded(): void {
  const value = arrays(integers().min(0).max(100)).minSize(3).maxSize(5).generate();
  assert(value.length >= 3 && value.length <= 5, "arrays(3,5) length must be in [3,5]");
  for (const v of value) {
    assert(v >= 0 && v <= 100, "array elements must be in [0,100]");
  }
  console.log(`arrays(3,5): [${value.join(", ")}]`);
}

function testArraysUnique(): void {
  const value = arrays(integers().min(0).max(1000)).minSize(5).maxSize(10).unique().generate();
  const uniqueSet = new Set(value);
  assert(uniqueSet.size === value.length, "unique arrays must have no duplicates");
  console.log(`arrays(unique): size=${value.length}, all unique`);
}

function testSets(): void {
  const value = sets(integers().min(0).max(100)).minSize(3).maxSize(5).generate();
  assert(value instanceof Set, "sets() must return Set");
  assert(value.size >= 3 && value.size <= 5, "sets(3,5) size must be in [3,5]");
  console.log(`sets(3,5): Set(${value.size})`);
}

function testMaps(): void {
  const value = maps(integers()).minSize(2).maxSize(5).generate();
  assert(value instanceof Map, "maps() must return Map");
  assert(value.size >= 2 && value.size <= 5, "maps(2,5) size must be in [2,5]");
  console.log(`maps(2,5): Map(${value.size})`);
}

function testTuples(): void {
  const value = tuples(integers(), text(), booleans()).generate();
  assert(Array.isArray(value) && value.length === 3, "tuples() must return array of length 3");
  assert(typeof value[0] === "number", "tuple[0] must be number");
  assert(typeof value[1] === "string", "tuple[1] must be string");
  assert(typeof value[2] === "boolean", "tuple[2] must be boolean");
  console.log(`tuples(int,text,bool): [${value[0]}, "${value[1].slice(0, 10)}", ${value[2]}]`);
}

function testSampledFromStrings(): void {
  const options = ["apple", "banana", "cherry"] as const;
  const value = sampledFrom(options).generate();
  assert(options.includes(value as typeof options[number]), "sampledFrom must return one of the options");
  console.log(`sampledFrom(fruits): "${value}"`);
}

function testSampledFromNumbers(): void {
  const options = [1, 2, 3, 4, 5] as const;
  const value = sampledFrom(options).generate();
  assert(options.includes(value as typeof options[number]), "sampledFrom must return one of the options");
  console.log(`sampledFrom(numbers): ${value}`);
}

function testOneOf(): void {
  const value = oneOf(
    integers().min(0).max(10),
    integers().min(100).max(110)
  ).generate();
  assert(
    (value >= 0 && value <= 10) || (value >= 100 && value <= 110),
    "oneOf must return from one of the ranges"
  );
  console.log(`oneOf(0-10, 100-110): ${value}`);
}

function testOptional(): void {
  const value = optional(integers().min(0).max(100)).generate();
  assert(
    value === null || (typeof value === "number" && value >= 0 && value <= 100),
    "optional must return null or value in range"
  );
  console.log(`optional(integers): ${value}`);
}

function testFixedObject(): void {
  const gen = fixedObject()
    .field("name", text().minSize(1).maxSize(20))
    .field("age", integers().min(0).max(120))
    .field("active", booleans())
    .build();

  const value = gen.generate();
  assert(typeof value.name === "string", "name must be string");
  assert(typeof value.age === "number", "age must be number");
  assert(typeof value.active === "boolean", "active must be boolean");
  console.log(`fixedObject: { name: "${value.name}", age: ${value.age}, active: ${value.active} }`);
}

function testMap(): void {
  const gen = integers().min(0).max(100).map((x) => x * 2);
  const value = gen.generate();
  assert(value % 2 === 0, "mapped value must be even");
  assert(value >= 0 && value <= 200, "mapped value must be in [0,200]");
  console.log(`integers().map(x => x * 2): ${value}`);
}

function testFilter(): void {
  const gen = integers().min(0).max(100).filter((x) => x % 2 === 0, 10);
  const value = gen.generate();
  assert(value % 2 === 0, "filtered value must be even");
  console.log(`integers().filter(even): ${value}`);
}

function testFlatMap(): void {
  const gen = integers().min(1).max(5).flatMap((n) =>
    arrays(integers().min(0).max(10)).minSize(n).maxSize(n)
  );
  const value = gen.generate();
  assert(Array.isArray(value), "flatMapped value must be array");
  assert(value.length >= 1 && value.length <= 5, "array length must be in [1,5]");
  console.log(`integers(1,5).flatMap(n => arrays(n)): [${value.join(", ")}]`);
}

function testNestedObject(): void {
  const addressGen = fixedObject()
    .field("street", text().minSize(1).maxSize(50))
    .field("city", text().minSize(1).maxSize(30))
    .build();

  const personGen = fixedObject()
    .field("name", text().minSize(1).maxSize(30))
    .field("age", integers().min(0).max(120))
    .field("address", addressGen)
    .build();

  const value = personGen.generate();
  assert(typeof value.name === "string", "person.name must be string");
  assert(typeof value.age === "number", "person.age must be number");
  assert(typeof value.address === "object", "person.address must be object");
  assert(typeof value.address.street === "string", "address.street must be string");
  assert(typeof value.address.city === "string", "address.city must be string");
  console.log(`nestedObject: { name: "${value.name}", age: ${value.age}, address: { street: "${value.address.street.slice(0, 15)}...", city: "${value.address.city}" } }`);
}

// ============================================================================
// Test registry
// ============================================================================

const allTests: Record<string, () => void> = {
  testNulls,
  testBooleans,
  testJust,
  testIntegersUnbounded,
  testIntegersBounded,
  testFloatsUnbounded,
  testFloatsBounded,
  testFloatsExclusive,
  testText,
  testTextBounded,
  testFromRegex,
  testEmails,
  testUrls,
  testDomains,
  testIpAddressesV4,
  testIpAddressesV6,
  testDates,
  testTimes,
  testDatetimes,
  testArrays,
  testArraysBounded,
  testArraysUnique,
  testSets,
  testMaps,
  testTuples,
  testSampledFromStrings,
  testSampledFromNumbers,
  testOneOf,
  testOptional,
  testFixedObject,
  testMap,
  testFilter,
  testFlatMap,
  testNestedObject,
};

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);
  const testNames = Object.keys(allTests);

  // If a specific test is requested via command line, run it
  if (args.length > 0) {
    const testName = args[0];
    if (testName in allTests) {
      console.log(`Running test: ${testName}`);
      allTests[testName]();
      console.log(`PASSED: ${testName}`);
      return;
    } else {
      console.error(`Unknown test: ${testName}`);
      console.error(`Available tests: ${testNames.join(", ")}`);
      process.exit(1);
    }
  }

  // Use sampledFrom to let Hegel explore different tests
  const selected = sampledFrom(testNames).generate();
  note(`Selected test: ${selected}`);

  if (selected in allTests) {
    allTests[selected]();
    console.log(`PASSED: ${selected}`);
  } else {
    console.error(`Unknown test: ${selected}`);
    process.exit(1);
  }
}

main();
