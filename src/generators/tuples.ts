/**
 * Tuple generators.
 *
 * @packageDocumentation
 */

import { TestCase, Labels } from "../testCase.js";
import { Generator, BasicGenerator, CompositeGenerator } from "./core.js";

// ---------------------------------------------------------------------------
// Tuples
// ---------------------------------------------------------------------------

/** Generate 2-tuples. */
export function tuples<A, B>(g1: Generator<A>, g2: Generator<B>): Generator<[A, B]> {
  return tuplesN([g1, g2]) as unknown as Generator<[A, B]>;
}

/** Generate 3-tuples. */
export function tuples3<A, B, C>(
  g1: Generator<A>,
  g2: Generator<B>,
  g3: Generator<C>,
): Generator<[A, B, C]> {
  return tuplesN([g1, g2, g3]) as unknown as Generator<[A, B, C]>;
}

/** Generate 4-tuples. */
export function tuples4<A, B, C, D>(
  g1: Generator<A>,
  g2: Generator<B>,
  g3: Generator<C>,
  g4: Generator<D>,
): Generator<[A, B, C, D]> {
  return tuplesN([g1, g2, g3, g4]) as unknown as Generator<[A, B, C, D]>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tuplesN(generators: Generator<any>[]): Generator<any[]> {
  const basics = generators.map((g) => g.asBasic());
  if (basics.every((b) => b !== null)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validBasics = basics as BasicGenerator<any>[];
    return new BasicGenerator(
      { type: "tuple", elements: validBasics.map((b) => b.schema) },
      (raw) => {
        if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
        return raw.map((v: unknown, i: number) => validBasics[i].parseRaw(v));
      },
    );
  }

  return new CompositeGenerator((tc: TestCase) => {
    tc.startSpan(Labels.TUPLE);
    const result = generators.map((g) => g.doDraw(tc));
    tc.stopSpan(false);
    return result;
  });
}
