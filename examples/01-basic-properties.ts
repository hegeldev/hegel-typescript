/**
 * Example 1: Basic Property Tests with Primitive Generators
 *
 * This example demonstrates the core Hegel pattern: use `runHegelTest` to
 * run a test body 100 times with random inputs, and `.generate()` on
 * generators to produce values inside the body.
 *
 * Run with:
 *   node --import tsx/esm examples/01-basic-properties.ts
 */

import { runHegelTest, integers, floats, booleans, text, binary, assume } from "../src/index.js";

// Helper: check a property and log result
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await runHegelTest(fn, { testCases: 50 });
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}: ${String(err)}`);
    process.exitCode = 1;
  }
}

// --- Integer properties ---

await check("integers are whole numbers", async () => {
  const n = await integers().generate();
  if (!Number.isInteger(n)) throw new Error(`Expected integer, got ${n}`);
});

await check("integer bounds are respected", async () => {
  const n = await integers(0, 100).generate();
  if (n < 0 || n > 100) throw new Error(`${n} out of [0, 100]`);
});

await check("addition is commutative", async () => {
  const a = await integers(-1000, 1000).generate();
  const b = await integers(-1000, 1000).generate();
  if (a + b !== b + a) throw new Error(`${a} + ${b} !== ${b} + ${a}`);
});

await check("subtraction reverses addition", async () => {
  const a = await integers(-1000, 1000).generate();
  const b = await integers(-1000, 1000).generate();
  if (a + b - b !== a) throw new Error(`(${a} + ${b}) - ${b} !== ${a}`);
});

// --- Float properties ---

await check("floats are finite when bounds given", async () => {
  const x = await floats(-1e6, 1e6).generate();
  if (!Number.isFinite(x)) throw new Error(`Expected finite float, got ${x}`);
});

await check("float absolute value is non-negative", async () => {
  const x = await floats(-1000, 1000).generate();
  const abs = Math.abs(x);
  if (abs < 0) throw new Error(`|${x}| = ${abs} < 0`);
});

// --- Boolean properties ---

await check("booleans are true or false", async () => {
  const b = await booleans().generate();
  if (b !== true && b !== false) throw new Error(`Expected boolean, got ${String(b)}`);
});

await check("double negation", async () => {
  const b = await booleans().generate();
  if (!!b !== b) throw new Error(`!!${String(b)} !== ${String(b)}`);
});

// --- Text properties ---

await check("text length is non-negative", async () => {
  const s = await text().generate();
  if (s.length < 0) throw new Error(`Negative length: ${s.length}`);
});

await check("text concat length", async () => {
  const s1 = await text(0, 20).generate();
  const s2 = await text(0, 20).generate();
  if (s1.concat(s2).length !== s1.length + s2.length) {
    throw new Error("Concat length mismatch");
  }
});

await check("text min_size is respected", async () => {
  const s = await text(5, 20).generate();
  if (s.length < 5) throw new Error(`Length ${s.length} < min_size 5`);
});

// --- Binary properties ---

await check("binary is a Uint8Array", async () => {
  const b = await binary(0, 10).generate();
  if (!(b instanceof Uint8Array)) throw new Error(`Expected Uint8Array, got ${typeof b}`);
});

// --- assume() ---

await check("division: Euclidean identity", async () => {
  const n = await integers(-100, 100).generate();
  const d = await integers(-20, 20).generate();
  assume(d !== 0); // skip if divisor is zero

  const q = Math.trunc(n / d);
  const r = n % d;
  if (q * d + r !== n) throw new Error(`Euclidean identity failed for ${n} / ${d}`);
});

console.log("\nDone.");
