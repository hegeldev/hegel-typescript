/**
 * Example 3: Real-World Scenario — Shopping Cart
 *
 * This example tests a simple shopping cart implementation using derived
 * generators for domain objects, demonstrating how property-based testing
 * finds bugs that unit tests often miss.
 *
 * Run with:
 *   node --import tsx/esm examples/03-real-world-scenario.ts
 */

import {
  runHegelTest,
  integers,
  floats,
  text,
  lists,
  optional,
  recordGenerator,
  variantGenerator,
  assume,
  note,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Domain model
// ---------------------------------------------------------------------------

interface Product {
  id: string;
  name: string;
  priceInCents: number; // integer cents to avoid float arithmetic issues
  category: "electronics" | "clothing" | "food";
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface Coupon {
  code: string;
  discountPercent: number; // 1..99
}

// ---------------------------------------------------------------------------
// Cart logic (the system under test)
// ---------------------------------------------------------------------------

function subtotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.product.priceInCents * item.quantity, 0);
}

function applyDiscount(totalCents: number, coupon: Coupon | null): number {
  if (coupon === null) return totalCents;
  return Math.round(totalCents * (1 - coupon.discountPercent / 100));
}

function taxRate(category: Product["category"]): number {
  switch (category) {
    case "electronics":
      return 0.08;
    case "clothing":
      return 0.05;
    case "food":
      return 0.0;
  }
}

function totalWithTax(items: CartItem[], coupon: Coupon | null): number {
  // Discount is applied before tax, per-item
  return items.reduce((sum, item) => {
    const itemTotal = item.product.priceInCents * item.quantity;
    const afterDiscount = applyDiscount(itemTotal, coupon);
    const tax = Math.round(afterDiscount * taxRate(item.product.category));
    return sum + afterDiscount + tax;
  }, 0);
}

function cartSummary(
  items: CartItem[],
  coupon: Coupon | null,
): { subtotal: number; discounted: number; total: number } {
  const sub = subtotal(items);
  const disc = applyDiscount(sub, coupon);
  const tot = totalWithTax(items, coupon);
  return { subtotal: sub, discounted: disc, total: tot };
}

// ---------------------------------------------------------------------------
// Generators for domain objects
// ---------------------------------------------------------------------------

const categoryGen = variantGenerator<{ type: Product["category"] }>(
  {
    electronics: null,
    clothing: null,
    food: null,
  },
  "type",
);

const productGen = recordGenerator({
  id: text(1, 8),
  name: text(1, 30),
  priceInCents: integers(1, 100_000), // 1 cent to $1,000
});

const cartItemGen = recordGenerator({
  quantity: integers(1, 10),
});

const couponGen = recordGenerator({
  code: text(3, 10),
  discountPercent: integers(1, 99),
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

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

// 1. Empty cart has zero totals
await check("empty cart: all totals are zero", async () => {
  const coupon = await optional(couponGen).generate();
  const summary = cartSummary([], coupon as Coupon | null);
  if (summary.subtotal !== 0) throw new Error(`Empty cart subtotal: ${summary.subtotal}`);
  if (summary.discounted !== 0) throw new Error(`Empty cart discounted: ${summary.discounted}`);
  if (summary.total !== 0) throw new Error(`Empty cart total: ${summary.total}`);
});

// 2. Total with no coupon ≥ subtotal (tax only adds, never removes)
await check("no coupon: total >= subtotal", async () => {
  const itemCount = await integers(1, 5).generate();
  const items: CartItem[] = [];
  for (let i = 0; i < itemCount; i++) {
    const base = await productGen.generate();
    const catVal = await categoryGen.generate();
    const product: Product = { ...base, category: catVal.type };
    const { quantity } = await cartItemGen.generate();
    items.push({ product, quantity });
  }
  const summary = cartSummary(items, null);
  if (summary.total < summary.subtotal)
    throw new Error(`total (${summary.total}) < subtotal (${summary.subtotal})`);
});

// 3. Discount reduces total (or keeps it equal for food with 0% tax, rounding)
await check("coupon: discounted <= subtotal", async () => {
  const items: CartItem[] = [];
  const itemCount = await integers(1, 5).generate();
  for (let i = 0; i < itemCount; i++) {
    const base = await productGen.generate();
    const catVal = await categoryGen.generate();
    const product: Product = { ...base, category: catVal.type };
    const { quantity } = await cartItemGen.generate();
    items.push({ product, quantity });
  }
  const coupon = await couponGen.generate();
  const summary = cartSummary(items, coupon as Coupon);
  if (summary.discounted > summary.subtotal)
    throw new Error(`discounted (${summary.discounted}) > subtotal (${summary.subtotal})`);
});

// 4. Totals are non-negative integers
await check("all totals are non-negative integers", async () => {
  const items: CartItem[] = [];
  const itemCount = await integers(0, 5).generate();
  for (let i = 0; i < itemCount; i++) {
    const base = await productGen.generate();
    const catVal = await categoryGen.generate();
    const product: Product = { ...base, category: catVal.type };
    const { quantity } = await cartItemGen.generate();
    items.push({ product, quantity });
  }
  const coupon = await optional(couponGen).generate();
  const summary = cartSummary(items, coupon as Coupon | null);

  if (!Number.isInteger(summary.subtotal) || summary.subtotal < 0)
    throw new Error(`Invalid subtotal: ${summary.subtotal}`);
  if (!Number.isInteger(summary.discounted) || summary.discounted < 0)
    throw new Error(`Invalid discounted: ${summary.discounted}`);
  if (!Number.isInteger(summary.total) || summary.total < 0)
    throw new Error(`Invalid total: ${summary.total}`);
});

// 5. Adding an item increases subtotal by at least the item's price
await check("adding item increases subtotal", async () => {
  const items: CartItem[] = [];
  const itemCount = await integers(0, 4).generate();
  for (let i = 0; i < itemCount; i++) {
    const base = await productGen.generate();
    const catVal = await categoryGen.generate();
    const product: Product = { ...base, category: catVal.type };
    const { quantity } = await cartItemGen.generate();
    items.push({ product, quantity });
  }

  const base = await productGen.generate();
  const catVal = await categoryGen.generate();
  const newProduct: Product = { ...base, category: catVal.type };
  const newQty = await integers(1, 5).generate();
  const newItem: CartItem = { product: newProduct, quantity: newQty };

  const before = subtotal(items);
  const after = subtotal([...items, newItem]);
  const expectedIncrease = newProduct.priceInCents * newQty;

  note(`before=${before}, after=${after}, item cost=${expectedIncrease}`);

  if (after - before !== expectedIncrease)
    throw new Error(`Subtotal increase should be ${expectedIncrease}, got ${after - before}`);
});

// 6. Tax category: food has zero tax
await check("food items have zero tax", async () => {
  const priceInCents = await integers(100, 10_000).generate();
  const quantity = await integers(1, 5).generate();
  const name = await text(1, 20).generate();
  const id = await text(1, 5).generate();

  const foodProduct: Product = { id, name, priceInCents, category: "food" };
  const items: CartItem[] = [{ product: foodProduct, quantity }];

  const summary = cartSummary(items, null);
  const expected = priceInCents * quantity;
  if (summary.total !== expected)
    throw new Error(
      `Food total (${summary.total}) should equal subtotal (${expected}) — no tax on food`,
    );
});

// 7. Ordering of items doesn't affect total (commutativity)
await check("cart total is order-independent", async () => {
  const items: CartItem[] = [];
  const itemCount = await integers(2, 5).generate();
  for (let i = 0; i < itemCount; i++) {
    const base = await productGen.generate();
    const catVal = await categoryGen.generate();
    const product: Product = { ...base, category: catVal.type };
    const { quantity } = await cartItemGen.generate();
    items.push({ product, quantity });
  }
  assume(items.length >= 2);

  const coupon = await optional(couponGen).generate();

  const total1 = cartSummary(items, coupon as Coupon | null).total;
  const total2 = cartSummary([...items].reverse(), coupon as Coupon | null).total;

  if (total1 !== total2)
    throw new Error(`Order matters! Forward total ${total1} != reversed total ${total2}`);
});

console.log("\nDone.");
