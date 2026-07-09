/**
 * Structural value equality used by collection generators.
 *
 * @packageDocumentation
 */

/**
 * Structural value equality, used by the collection generators (arrays with
 * `unique: true`, sets, and maps) to decide whether two generated values are
 * duplicates. It mirrors the engine's value-equality semantics: two values are
 * equal when they have the same structure and equal contents, not merely when
 * they are the same reference.
 *
 * Semantics:
 *
 * - Primitives (strings, booleans, bigints, null, undefined) compare with
 *   `===`. Values of different types are never equal (`1n` is not `1`).
 * - Numbers compare like JS `Set`/`Map` keys (SameValueZero): `NaN` equals
 *   `NaN`, and `0` equals `-0`.
 * - Functions and symbols compare by reference.
 * - Arrays compare element-wise, `Uint8Array`s byte-wise, and `Date`s by
 *   timestamp.
 * - `Set`s and `Map`s compare as unordered collections of structurally equal
 *   elements/entries.
 * - Other objects compare by their own enumerable string-keyed properties.
 *
 * @internal
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true; // Also covers 0 === -0.
  if (typeof a === "number" && typeof b === "number") {
    // `a === b` was false, so they are equal only if both are NaN.
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => valuesEqual(v, b[i]))
    );
  }
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return (
      a instanceof Uint8Array &&
      b instanceof Uint8Array &&
      a.length === b.length &&
      a.every((v, i) => v === b[i])
    );
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false;
    return unorderedEqual([...a], [...b], valuesEqual);
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
    return unorderedEqual(
      [...a.entries()],
      [...b.entries()],
      (x, y) => valuesEqual(x[0], y[0]) && valuesEqual(x[1], y[1]),
    );
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && valuesEqual(a.getTime(), b.getTime());
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  const objB = b as Record<string, unknown>;
  return keysA.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(objB, k) &&
      valuesEqual((a as Record<string, unknown>)[k], objB[k]),
  );
}

/**
 * Whether the elements of `a` and `b` (of equal length) can be matched up
 * one-to-one under `eq`. Quadratic, but collection sizes are small.
 */
function unorderedEqual<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): boolean {
  const used = new Array<boolean>(b.length).fill(false);
  return a.every((x) => {
    const i = b.findIndex((y, j) => !used[j] && eq(x, y));
    if (i === -1) return false;
    used[i] = true;
    return true;
  });
}
