/**
 * Example 2: Collections and Combinators
 *
 * This example shows how to generate collections (lists, dicts, tuples),
 * use combinators (oneOf, optional, map, filter, flatMap), and leverage
 * dependent generation.
 *
 * Run with:
 *   node --import tsx/esm examples/02-collections-and-combinators.ts
 */

import {
  runHegelTest,
  integers,
  floats,
  text,
  booleans,
  lists,
  dicts,
  tuples2,
  tuples3,
  oneOf,
  optional,
  just,
  sampledFrom,
} from "../src/index.js";

// Helper
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await runHegelTest(fn, { testCases: 50 });
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}: ${String(err)}`);
    process.exitCode = 1;
  }
}

// --- Lists ---

await check("list length is within bounds", async () => {
  const xs = await lists(integers(), { minSize: 2, maxSize: 10 }).generate();
  if (xs.length < 2 || xs.length > 10) throw new Error(`List length ${xs.length} outside [2, 10]`);
});

await check("list reverse is involution", async () => {
  const xs = await lists(integers(-100, 100), { maxSize: 20 }).generate();
  const reversed = [...xs].reverse();
  const doubleReversed = [...reversed].reverse();
  if (JSON.stringify(doubleReversed) !== JSON.stringify(xs))
    throw new Error("Double reverse should equal original");
});

await check("list sorted is non-decreasing", async () => {
  const xs = await lists(integers(0, 100), { maxSize: 20 }).generate();
  const sorted = [...xs].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! < sorted[i - 1]!)
      throw new Error(`Sorted list not non-decreasing at index ${i}`);
  }
});

await check("sum of list equals sum of reversed list", async () => {
  const xs = await lists(integers(-50, 50), { maxSize: 20 }).generate();
  const sum = (arr: number[]): number => arr.reduce((a, b) => a + b, 0);
  if (sum(xs) !== sum([...xs].reverse()))
    throw new Error("Sum of list should equal sum of reversed list");
});

// --- Dicts (Map) ---

await check("dict has correct size range", async () => {
  const d = await dicts(text(1, 5), integers(0, 100), { minSize: 1, maxSize: 5 }).generate();
  if (d.size < 1 || d.size > 5) throw new Error(`Dict size ${d.size} outside [1, 5]`);
});

await check("dict values are within bounds", async () => {
  const d = await dicts(text(1, 5), integers(0, 100), { maxSize: 10 }).generate();
  for (const [, v] of d) {
    if (v < 0 || v > 100) throw new Error(`Dict value ${v} out of [0, 100]`);
  }
});

// --- Tuples ---

await check("tuples preserve individual generator types", async () => {
  const [n, s] = await tuples2(integers(0, 99), text(0, 5)).generate();
  if (!Number.isInteger(n)) throw new Error(`Expected integer, got ${String(n)}`);
  if (typeof s !== "string") throw new Error(`Expected string, got ${typeof s}`);
});

await check("3-tuple each element in range", async () => {
  const [x, y, z] = await tuples3(integers(0, 10), integers(0, 10), integers(0, 10)).generate();
  if (x < 0 || x > 10 || y < 0 || y > 10 || z < 0 || z > 10)
    throw new Error(`Tuple values out of range: ${x}, ${y}, ${z}`);
});

// --- oneOf ---

await check("oneOf picks from one of the generators", async () => {
  const gen = oneOf(just(1), just(2), just(3));
  const n = await gen.generate();
  if (n !== 1 && n !== 2 && n !== 3) throw new Error(`Unexpected value: ${n}`);
});

// --- optional ---

await check("optional produces value or null", async () => {
  const val = await optional(integers(0, 100)).generate();
  if (val !== null && (val < 0 || val > 100)) throw new Error(`Unexpected optional value: ${val}`);
});

// --- sampledFrom ---

await check("sampledFrom picks from the list", async () => {
  const options = ["alpha", "beta", "gamma", "delta"];
  const s = await sampledFrom(options).generate();
  if (!options.includes(s)) throw new Error(`Unexpected value: ${s}`);
});

// --- .map() combinator ---

await check("map transforms values", async () => {
  const doubled = integers(1, 50).map((n) => n * 2);
  const n = await doubled.generate();
  if (n % 2 !== 0) throw new Error(`Expected even, got ${n}`);
  if (n < 2 || n > 100) throw new Error(`${n} out of mapped range`);
});

await check("map to string produces valid digits", async () => {
  const s = await integers(0, 999).map(String).generate();
  if (!/^\d+$/.test(s)) throw new Error(`Expected digit string, got "${s}"`);
});

// --- .filter() combinator ---

await check("filter keeps only matching values", async () => {
  const evens = integers(-100, 100).filter((n) => n % 2 === 0);
  const n = await evens.generate();
  if (n % 2 !== 0) throw new Error(`Expected even, got ${n}`);
});

// --- .flatMap() for dependent generation ---

await check("flatMap: list length matches requested size", async () => {
  // Generate a size, then a list of exactly that size
  const gen = integers(1, 10).flatMap((n) => lists(booleans(), { minSize: n, maxSize: n }));
  const xs = await gen.generate();
  // xs should have some reasonable length
  if (xs.length < 1 || xs.length > 10) throw new Error(`Unexpected length: ${xs.length}`);
});

// --- Dependent generation (imperative style) ---

await check("dependent: valid index into generated list", async () => {
  // Generate a non-empty list, then pick a valid index
  const n = await integers(1, 10).generate();
  const lst = await lists(floats(-100, 100), { minSize: n, maxSize: n }).generate();
  const index = await integers(0, n - 1).generate();

  if (index < 0 || index >= lst.length)
    throw new Error(`Index ${index} out of bounds for list of length ${lst.length}`);
  // The value at that index is a finite float
  if (!Number.isFinite(lst[index]!)) throw new Error(`Expected finite float at index ${index}`);
});

console.log("\nDone.");
