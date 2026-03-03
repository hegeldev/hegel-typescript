/**
 * Type-directed generator derivation for the Hegel SDK.
 *
 * TypeScript erases interface and type information at compile time, but
 * **classes** persist at runtime with real constructors and field names.
 * This module uses TypeScript legacy decorators (`experimentalDecorators`)
 * to associate generators with class fields. Users annotate their class
 * with `@field(gen)` on each property, then call `deriveGenerator(MyClass)`
 * to get a composite generator that builds instances by generating each
 * field independently.
 *
 * For plain-object records (no class needed), use {@link recordGenerator}.
 *
 * For sum types (discriminated unions), {@link variantGenerator} builds
 * a generator that picks a variant uniformly at random and produces an
 * object with the discriminant tag and generated fields.
 *
 * @example
 * ```ts
 * class Point {
 *   \@field(floats(-100, 100))
 *   x!: number;
 *
 *   \@field(floats(-100, 100))
 *   y!: number;
 * }
 *
 * const gen = deriveGenerator(Point);
 * // draw(gen) returns a Point instance with random x, y
 * ```
 *
 * @packageDocumentation
 */

import { Generator, BasicGenerator } from "./generators.js";
import { startSpan, stopSpan, Labels } from "./runner.js";
import type { TestCaseData } from "./runner.js";

// ---------------------------------------------------------------------------
// Metadata storage
// ---------------------------------------------------------------------------

/**
 * Metadata entry for a single field.
 * @internal
 */
export interface FieldMeta {
  /** The property name on the class instance. */
  name: string | symbol;
  /** The generator to use for this field. */
  generator: Generator;
  /** The order the decorator was applied (for deterministic iteration). */
  order: number;
}

/**
 * Type for class constructors in the metadata map.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConstructor = new (...args: any[]) => any;

/**
 * Map from constructor → ordered list of field metadata.
 * Each class that uses `@field(...)` gets an entry here.
 * @internal
 */
export const _classFieldMeta = new Map<AnyConstructor, FieldMeta[]>();

/** Global counter to ensure deterministic field ordering. @internal */
let _fieldOrder = 0;

/**
 * Reset the field order counter. Only for testing.
 * @internal
 */
export function _resetFieldOrder(): void {
  _fieldOrder = 0;
}

// ---------------------------------------------------------------------------
// @field decorator
// ---------------------------------------------------------------------------

/**
 * Decorator that associates a {@link Generator} with a class field.
 *
 * Use this on each field of a class before calling {@link deriveGenerator}.
 * Fields are generated in decorator-application order (typically top to
 * bottom in the class body).
 *
 * Requires `experimentalDecorators: true` in `tsconfig.json`.
 *
 * @example
 * ```ts
 * class User {
 *   \@field(text(1, 50))
 *   name!: string;
 *
 *   \@field(integers(18, 120))
 *   age!: number;
 * }
 * ```
 *
 * @param gen - The generator to use for this field's values.
 */
export function field<T>(gen: Generator<T>): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    const ctor = target.constructor as AnyConstructor;
    let list = _classFieldMeta.get(ctor);
    if (!list) {
      list = [];
      _classFieldMeta.set(ctor, list);
    }
    list.push({ name: propertyKey, generator: gen, order: _fieldOrder++ });
  };
}

// ---------------------------------------------------------------------------
// DerivedGenerator
// ---------------------------------------------------------------------------

/**
 * A generator that produces instances of a class by generating each
 * decorated field independently.
 *
 * Uses a FIXED_DICT span (label 10) to group the field generations,
 * matching the Hegel protocol's semantic for record/struct types.
 *
 * @typeParam T - The class type being generated.
 */
export class DerivedGenerator<T> extends Generator<T> {
  /** @internal */
  readonly _ctor: new () => T;
  /** @internal */
  readonly _fields: ReadonlyArray<FieldMeta>;

  constructor(ctor: new () => T, fields: FieldMeta[]) {
    super();
    this._ctor = ctor;
    this._fields = [...fields].sort((a, b) => a.order - b.order);
  }

  async doDraw(data: TestCaseData): Promise<T> {
    await startSpan(Labels.FIXED_DICT, data);
    try {
      const instance = new this._ctor();
      for (const f of this._fields) {
        (instance as Record<string | symbol, unknown>)[f.name] = await f.generator.doDraw(data);
      }
      return instance;
    } finally {
      await stopSpan({}, data);
    }
  }
}

// ---------------------------------------------------------------------------
// deriveGenerator
// ---------------------------------------------------------------------------

/**
 * Derive a generator for a class from its `@field(...)` annotations.
 *
 * Reads the generator metadata registered by the {@link field} decorator
 * and returns a {@link DerivedGenerator} that produces instances of the
 * class with each field independently generated.
 *
 * @param ctor - The class constructor (must have a no-arg constructor).
 * @throws {Error} If the class has no `@field` annotations.
 *
 * @example
 * ```ts
 * class Config {
 *   \@field(booleans()) debug!: boolean;
 *   \@field(integers(1, 65535)) port!: number;
 * }
 * const gen = deriveGenerator(Config);
 * const cfg = await draw(gen); // Config { debug: true, port: 8080 }
 * ```
 */
export function deriveGenerator<T>(ctor: new () => T): DerivedGenerator<T> {
  const fields = _classFieldMeta.get(ctor);
  if (!fields || fields.length === 0) {
    throw new Error(
      `No @field annotations found on ${ctor.name}. ` +
        `Decorate fields with @field(generator) before calling deriveGenerator().`,
    );
  }
  return new DerivedGenerator<T>(ctor, fields);
}

// ---------------------------------------------------------------------------
// recordGenerator — anonymous record derivation (no class needed)
// ---------------------------------------------------------------------------

/**
 * A generator that produces plain objects from a schema mapping.
 *
 * Uses a FIXED_DICT span (label 10) internally.
 *
 * @typeParam T - The resulting object type.
 */
export class RecordDerivedGenerator<T> extends Generator<T> {
  /** @internal */
  readonly _entries: ReadonlyArray<[string, Generator]>;

  constructor(entries: Array<[string, Generator]>) {
    super();
    this._entries = entries;
  }

  async doDraw(data: TestCaseData): Promise<T> {
    await startSpan(Labels.FIXED_DICT, data);
    try {
      const result: Record<string, unknown> = {};
      for (const [key, gen] of this._entries) {
        result[key] = await gen.doDraw(data);
      }
      return result as T;
    } finally {
      await stopSpan({}, data);
    }
  }
}

/**
 * Derive a generator for a plain-object record type from a schema mapping
 * field names to generators.
 *
 * This is the "no-class" alternative: the user provides the structure
 * explicitly as an object mapping field names to generators. The result
 * is a generator that produces plain objects with the specified fields.
 *
 * @example
 * ```ts
 * const pointGen = recordGenerator({
 *   x: floats(-100, 100),
 *   y: floats(-100, 100),
 * });
 * const pt = await draw(pointGen); // { x: 42.5, y: -3.14 }
 * ```
 *
 * @param schema - Mapping from field name to its generator.
 * @throws {Error} If the schema has no fields.
 */
export function recordGenerator<S extends Record<string, Generator>>(
  schema: S,
): RecordDerivedGenerator<{ [K in keyof S]: S[K] extends Generator<infer V> ? V : never }> {
  const entries = Object.entries(schema);
  if (entries.length === 0) {
    throw new Error("recordGenerator requires at least one field.");
  }
  return new RecordDerivedGenerator<{
    [K in keyof S]: S[K] extends Generator<infer V> ? V : never;
  }>(entries);
}

// ---------------------------------------------------------------------------
// Variant generator — sum types / discriminated unions
// ---------------------------------------------------------------------------

/**
 * A single variant in a discriminated union.
 */
export interface VariantDef {
  /** The discriminant value (e.g., "circle", "rectangle"). */
  tag: string;
  /**
   * Generator for the variant's fields. When `null`, the variant has no
   * extra data — the generator produces `{ type: tag }` only.
   */
  fields: Generator | null;
}

/**
 * A generator that produces values of a discriminated union type.
 *
 * Picks a variant uniformly at random, generates its fields, and returns
 * an object with the discriminant key set to the variant tag, plus the
 * generated field values spread in. Uses an ENUM_VARIANT span (label 15)
 * for each generated value.
 *
 * @typeParam T - The union type being generated.
 */
export class VariantGenerator<T> extends Generator<T> {
  /** @internal */
  readonly _variants: ReadonlyArray<VariantDef>;
  /** @internal */
  readonly _discriminant: string;
  /** @internal */
  private readonly _indexGen: BasicGenerator<number>;

  constructor(variants: VariantDef[], discriminant: string) {
    super();
    this._variants = variants;
    this._discriminant = discriminant;
    this._indexGen = new BasicGenerator<number>({
      type: "integer",
      min_value: 0,
      max_value: variants.length - 1,
    });
  }

  async doDraw(data: TestCaseData): Promise<T> {
    await startSpan(Labels.ENUM_VARIANT, data);
    try {
      const index = await this._indexGen.doDraw(data);
      const variant = this._variants[index]!;
      if (variant.fields !== null) {
        const fields = await variant.fields.doDraw(data);
        return { [this._discriminant]: variant.tag, ...(fields as object) } as T;
      }
      return { [this._discriminant]: variant.tag } as T;
    } finally {
      await stopSpan({}, data);
    }
  }
}

/**
 * Derive a generator for a discriminated union (sum type).
 *
 * Takes a mapping from variant tag names to their field generators (or
 * `null` for data-less variants). Returns a {@link VariantGenerator}
 * that picks a variant uniformly at random and generates its fields.
 *
 * @example
 * ```ts
 * type Shape =
 *   | { type: "circle"; radius: number }
 *   | { type: "rectangle"; width: number; height: number };
 *
 * const shapeGen = variantGenerator<Shape>({
 *   circle: recordGenerator({ radius: floats(0.1, 100) }),
 *   rectangle: recordGenerator({
 *     width: floats(0.1, 100),
 *     height: floats(0.1, 100),
 *   }),
 * });
 *
 * const shape = await draw(shapeGen);
 * // { type: "circle", radius: 42.5 }  or  { type: "rectangle", width: 10, height: 20 }
 * ```
 *
 * @param variants - Mapping from tag name to field generator (or `null`
 *   for data-less variants).
 * @param discriminant - The discriminant property name. Defaults to `"type"`.
 * @throws {Error} If fewer than 2 variants are provided.
 */
export function variantGenerator<T>(
  variants: Record<string, Generator | null>,
  discriminant = "type",
): VariantGenerator<T> {
  const entries = Object.entries(variants);
  if (entries.length < 2) {
    throw new Error("variantGenerator requires at least 2 variants.");
  }
  const defs: VariantDef[] = entries.map(([tag, gen]) => ({
    tag,
    fields: gen,
  }));
  return new VariantGenerator<T>(defs, discriminant);
}
