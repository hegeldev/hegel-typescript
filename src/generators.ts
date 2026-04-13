/**
 * Generator system: base classes, combinators, and all built-in generators.
 *
 * @packageDocumentation
 */

import {
  TestCase,
  Collection,
  Labels,
  StopTestError,
  generateRaw,
  type GeneratorLike,
} from "./testCase.js";

// ---------------------------------------------------------------------------
// Generator base class
// ---------------------------------------------------------------------------

/**
 * Base class for all generators. Generators produce values of type T
 * synchronously by communicating with the hegel server.
 */
export abstract class Generator<T> implements GeneratorLike<T> {
  /** @internal */
  abstract doDraw(tc: TestCase): T;

  /** @internal */
  asBasic(): BasicGenerator<T> | null {
    return null;
  }

  /**
   * Transform generated values using a function.
   * When the source has a schema, the schema is preserved.
   */
  map<U>(f: (value: T) => U): Generator<U> {
    return new MappedGenerator(this, f);
  }

  /**
   * Generate a value, then use it to choose another generator.
   */
  flatMap<U>(f: (value: T) => Generator<U>): Generator<U> {
    return new FlatMappedGenerator(this, f);
  }

  /**
   * Only keep values that satisfy the predicate.
   * Retries up to 3 times, then rejects the test case.
   */
  filter(predicate: (value: T) => boolean): Generator<T> {
    return new FilteredGenerator(this, predicate);
  }
}

// ---------------------------------------------------------------------------
// BasicGenerator
// ---------------------------------------------------------------------------

/**
 * Schema-based generator that sends a schema to the server and parses the response.
 */
export class BasicGenerator<T> extends Generator<T> {
  readonly schema: Record<string, unknown>;
  private readonly parse: ((raw: unknown) => T) | null;

  constructor(schema: Record<string, unknown>, parse?: (raw: unknown) => T) {
    super();
    this.schema = schema;
    this.parse = parse ?? null;
  }

  doDraw(tc: TestCase): T {
    const raw = generateRaw(tc, this.schema);
    if (this.parse) {
      return this.parse(raw);
    }
    return raw as T;
  }

  asBasic(): BasicGenerator<T> {
    return this;
  }

  parseRaw(raw: unknown): T {
    if (this.parse) {
      return this.parse(raw);
    }
    return raw as T;
  }

  override map<U>(f: (value: T) => U): BasicGenerator<U> {
    const oldParse = this.parse;
    return new BasicGenerator(this.schema, (raw: unknown) => {
      const t = oldParse ? oldParse(raw) : (raw as T);
      return f(t);
    });
  }
}

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

class MappedGenerator<T, U> extends Generator<U> {
  private source: Generator<T>;
  private f: (value: T) => U;

  constructor(source: Generator<T>, f: (value: T) => U) {
    super();
    this.source = source;
    this.f = f;
  }

  doDraw(tc: TestCase): U {
    // MappedGenerator is only created for non-basic sources (BasicGenerator
    // overrides .map() to return a BasicGenerator directly). So asBasic()
    // would always return null here — we go straight to the span-based path.
    tc.startSpan(Labels.MAPPED);
    const result = this.f(this.source.doDraw(tc));
    tc.stopSpan(false);
    return result;
  }
}

class FlatMappedGenerator<T, U> extends Generator<U> {
  private source: Generator<T>;
  private f: (value: T) => Generator<U>;

  constructor(source: Generator<T>, f: (value: T) => Generator<U>) {
    super();
    this.source = source;
    this.f = f;
  }

  doDraw(tc: TestCase): U {
    tc.startSpan(Labels.FLAT_MAP);
    const intermediate = this.source.doDraw(tc);
    const nextGen = this.f(intermediate);
    const result = nextGen.doDraw(tc);
    tc.stopSpan(false);
    return result;
  }
}

class FilteredGenerator<T> extends Generator<T> {
  private source: Generator<T>;
  private predicate: (value: T) => boolean;

  constructor(source: Generator<T>, predicate: (value: T) => boolean) {
    super();
    this.source = source;
    this.predicate = predicate;
  }

  doDraw(tc: TestCase): T {
    for (let i = 0; i < 3; i++) {
      tc.startSpan(Labels.FILTER);
      const value = this.source.doDraw(tc);
      if (this.predicate(value)) {
        tc.stopSpan(false);
        return value;
      }
      tc.stopSpan(true);
    }
    tc.assume(false);
    throw new Error("unreachable");
  }
}

class CompositeGenerator<T> extends Generator<T> {
  private fn: (tc: TestCase) => T;

  constructor(fn: (tc: TestCase) => T) {
    super();
    this.fn = fn;
  }

  doDraw(tc: TestCase): T {
    return this.fn(tc);
  }
}

// ---------------------------------------------------------------------------
// Integers
// ---------------------------------------------------------------------------

export interface IntegerOptions {
  minValue?: number;
  maxValue?: number;
}

/** Generate integers. Defaults to the safe integer range. */
export function integers(options?: IntegerOptions): BasicGenerator<number> {
  const min = options?.minValue ?? -(2 ** 53 - 1);
  const max = options?.maxValue ?? 2 ** 53 - 1;
  if (min > max) throw new Error("Cannot have maxValue < minValue");
  return new BasicGenerator({ type: "integer", min_value: min, max_value: max });
}

// ---------------------------------------------------------------------------
// Floats
// ---------------------------------------------------------------------------

export interface FloatOptions {
  minValue?: number;
  maxValue?: number;
  excludeMin?: boolean;
  excludeMax?: boolean;
  allowNan?: boolean;
  allowInfinity?: boolean;
}

/**
 * Generate floating-point numbers.
 *
 * By default, NaN is allowed only when no bounds are set, and infinity
 * is allowed when at least one bound is missing.
 */
export function floats(options?: FloatOptions): BasicGenerator<number> {
  const hasMin = options?.minValue !== undefined;
  const hasMax = options?.maxValue !== undefined;
  // NaN only when completely unbounded; infinity when at least one side is open
  const allowNan = options?.allowNan ?? (!hasMin && !hasMax);
  const allowInfinity = options?.allowInfinity ?? (!hasMin || !hasMax);

  const schema: Record<string, unknown> = {
    type: "float",
    width: 64,
    allow_nan: allowNan,
    allow_infinity: allowInfinity,
  };

  if (hasMin) {
    schema["min_value"] = options!.minValue;
    schema["exclude_min"] = options?.excludeMin ?? false;
  }
  if (hasMax) {
    schema["max_value"] = options!.maxValue;
    schema["exclude_max"] = options?.excludeMax ?? false;
  }

  return new BasicGenerator(schema);
}

// ---------------------------------------------------------------------------
// Booleans
// ---------------------------------------------------------------------------

/** Generate boolean values. */
export function booleans(): BasicGenerator<boolean> {
  return new BasicGenerator({ type: "boolean" });
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Options for character filtering, shared between text() and characters().
 *
 * `alphabet` is a shorthand that sets `includeCharacters` and clears categories.
 * It cannot be combined with other character filtering options.
 */
export interface CharacterFilterOptions {
  /** Restrict to characters in this explicit set. Mutually exclusive with other character options. */
  alphabet?: string;
  /** Restrict to characters encodable in this codec (e.g. "ascii", "utf-8", "latin-1"). */
  codec?: string;
  /** Minimum Unicode codepoint (inclusive). */
  minCodepoint?: number;
  /** Maximum Unicode codepoint (inclusive). */
  maxCodepoint?: number;
  /** Include only characters from these Unicode general categories (e.g. ["L", "Nd"]). */
  categories?: string[];
  /** Exclude characters from these Unicode general categories. */
  excludeCategories?: string[];
  /** Always include these specific characters. */
  includeCharacters?: string;
  /** Always exclude these specific characters. */
  excludeCharacters?: string;
}

export interface TextOptions extends CharacterFilterOptions {
  minSize?: number;
  maxSize?: number;
}

function buildCharacterSchema(options: CharacterFilterOptions): Record<string, unknown> {
  const hasAlphabet = options.alphabet !== undefined;
  const hasCharParams =
    options.codec !== undefined ||
    options.minCodepoint !== undefined ||
    options.maxCodepoint !== undefined ||
    options.categories !== undefined ||
    options.excludeCategories !== undefined ||
    options.includeCharacters !== undefined ||
    options.excludeCharacters !== undefined;

  if (hasAlphabet && hasCharParams) {
    throw new Error("Cannot combine alphabet with other character filtering options");
  }

  if (hasAlphabet) {
    // alphabet() in Rust sets categories=[] and includeCharacters=chars
    return {
      categories: [],
      include_characters: options.alphabet,
    };
  }

  const schema: Record<string, unknown> = {};
  if (options.codec !== undefined) schema["codec"] = options.codec;
  if (options.minCodepoint !== undefined) schema["min_codepoint"] = options.minCodepoint;
  if (options.maxCodepoint !== undefined) schema["max_codepoint"] = options.maxCodepoint;
  if (options.categories !== undefined) schema["categories"] = options.categories;
  if (options.excludeCategories !== undefined)
    schema["exclude_categories"] = options.excludeCategories;
  if (options.includeCharacters !== undefined)
    schema["include_characters"] = options.includeCharacters;
  if (options.excludeCharacters !== undefined)
    schema["exclude_characters"] = options.excludeCharacters;
  return schema;
}

/** Generate text strings. */
export function text(options?: TextOptions): BasicGenerator<string> {
  const schema: Record<string, unknown> = {
    type: "string",
    min_size: options?.minSize ?? 0,
  };
  if (options?.maxSize !== undefined) {
    schema["max_size"] = options.maxSize;
  }
  if (options) {
    Object.assign(schema, buildCharacterSchema(options));
  }
  return new BasicGenerator(schema, (raw) => String(raw));
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export type CharacterOptions = CharacterFilterOptions;

/** Generate single characters. */
export function characters(options?: CharacterOptions): BasicGenerator<string> {
  const schema: Record<string, unknown> = {
    type: "string",
    min_size: 1,
    max_size: 1,
  };
  if (options) {
    Object.assign(schema, buildCharacterSchema(options));
  }
  return new BasicGenerator(schema, (raw) => String(raw));
}

// ---------------------------------------------------------------------------
// Binary
// ---------------------------------------------------------------------------

export interface BinaryOptions {
  minSize?: number;
  maxSize?: number;
}

function parseBytes(raw: unknown): Uint8Array {
  // Buffer is a subclass of Uint8Array, so this catches both.
  if (raw instanceof Uint8Array) return raw;
  throw new Error(`Expected bytes, got ${typeof raw}`);
}

/** Generate binary data (Uint8Array). */
export function binary(options?: BinaryOptions): BasicGenerator<Uint8Array> {
  const schema: Record<string, unknown> = {
    type: "binary",
    min_size: options?.minSize ?? 0,
  };
  if (options?.maxSize !== undefined) {
    schema["max_size"] = options.maxSize;
  }
  return new BasicGenerator(schema, parseBytes);
}

// ---------------------------------------------------------------------------
// Just
// ---------------------------------------------------------------------------

/** Generate a constant value. */
export function just<T>(value: T): Generator<T> {
  return new CompositeGenerator(() => value);
}

// ---------------------------------------------------------------------------
// SampledFrom
// ---------------------------------------------------------------------------

/** Pick uniformly from a fixed list of values. Panics if empty. */
export function sampledFrom<T>(elements: T[]): BasicGenerator<T> {
  if (elements.length === 0) {
    throw new Error("sampledFrom requires at least one element");
  }
  const copy = [...elements];
  return new BasicGenerator(
    { type: "integer", min_value: 0, max_value: copy.length - 1 },
    (raw) => copy[raw as number],
  );
}

// ---------------------------------------------------------------------------
// FromRegex
// ---------------------------------------------------------------------------

export interface RegexOptions {
  fullmatch?: boolean;
}

/** Generate strings matching a regex pattern. Defaults to substring match. */
export function fromRegex(pattern: string, options?: RegexOptions): BasicGenerator<string> {
  return new BasicGenerator(
    {
      type: "regex",
      pattern,
      fullmatch: options?.fullmatch ?? false,
    },
    (raw) => String(raw),
  );
}

// ---------------------------------------------------------------------------
// Arrays (lists)
// ---------------------------------------------------------------------------

export interface CollectionOptions {
  minSize?: number;
  maxSize?: number;
}

export interface ArrayOptions extends CollectionOptions {
  unique?: boolean;
}

/** Generate arrays with elements from the given generator. */
export function arrays<T>(elements: Generator<T>, options?: ArrayOptions): Generator<T[]> {
  const minSize = options?.minSize ?? 0;
  const maxSize = options?.maxSize ?? null;
  const unique = options?.unique ?? false;

  if (maxSize !== null && minSize > maxSize) {
    throw new Error("Cannot have maxSize < minSize");
  }

  // Try schema-based path
  const elementBasic = elements.asBasic();
  if (elementBasic) {
    const schema: Record<string, unknown> = {
      type: "list",
      unique,
      elements: elementBasic.schema,
      min_size: minSize,
    };
    if (maxSize !== null) schema["max_size"] = maxSize;

    return new BasicGenerator(schema, (raw) => {
      if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
      return raw.map((v: unknown) => elementBasic.parseRaw(v));
    });
  }

  // Fallback: collection protocol
  return new CompositeGenerator((tc) => {
    tc.startSpan(Labels.LIST);
    const collection = new Collection(tc, minSize, maxSize ?? undefined);
    const result: T[] = [];
    while (collection.more()) {
      const element = elements.doDraw(tc);
      if (unique) {
        if (result.some((existing) => JSON.stringify(existing) === JSON.stringify(element))) {
          collection.reject("duplicate element");
          continue;
        }
      }
      result.push(element);
    }
    tc.stopSpan(false);
    return result;
  });
}

export { arrays as lists };

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

/** Generate Sets with elements from the given generator. */
export function sets<T>(elements: Generator<T>, options?: CollectionOptions): Generator<Set<T>> {
  const minSize = options?.minSize ?? 0;
  const maxSize = options?.maxSize ?? null;

  if (maxSize !== null && minSize > maxSize) {
    throw new Error("Cannot have maxSize < minSize");
  }

  const elementBasic = elements.asBasic();
  if (elementBasic) {
    const schema: Record<string, unknown> = {
      type: "list",
      unique: true,
      elements: elementBasic.schema,
      min_size: minSize,
    };
    if (maxSize !== null) schema["max_size"] = maxSize;

    return new BasicGenerator(schema, (raw) => {
      if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
      return new Set(raw.map((v: unknown) => elementBasic.parseRaw(v)));
    });
  }

  return new CompositeGenerator((tc) => {
    tc.startSpan(Labels.SET);
    const collection = new Collection(tc, minSize, maxSize ?? undefined);
    const result = new Set<T>();
    while (collection.more()) {
      const element = elements.doDraw(tc);
      if (result.has(element)) {
        collection.reject("duplicate element");
        continue;
      }
      result.add(element);
    }
    tc.stopSpan(false);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Maps (dicts)
// ---------------------------------------------------------------------------

/** Generate Maps with keys and values from the given generators. */
export function maps<K, V>(
  keys: Generator<K>,
  values: Generator<V>,
  options?: CollectionOptions,
): Generator<Map<K, V>> {
  const minSize = options?.minSize ?? 0;
  const maxSize = options?.maxSize ?? null;

  if (maxSize !== null && minSize > maxSize) {
    throw new Error("Cannot have maxSize < minSize");
  }

  const keyBasic = keys.asBasic();
  const valueBasic = values.asBasic();

  if (keyBasic && valueBasic) {
    const schema: Record<string, unknown> = {
      type: "dict",
      keys: keyBasic.schema,
      values: valueBasic.schema,
      min_size: minSize,
    };
    if (maxSize !== null) schema["max_size"] = maxSize;

    return new BasicGenerator(schema, (raw) => {
      if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
      const map = new Map<K, V>();
      for (const entry of raw) {
        if (!Array.isArray(entry) || entry.length !== 2) {
          throw new Error("Expected [key, value] pair");
        }
        map.set(keyBasic.parseRaw(entry[0]), valueBasic.parseRaw(entry[1]));
      }
      return map;
    });
  }

  return new CompositeGenerator((tc) => {
    tc.startSpan(Labels.MAP);
    const collection = new Collection(tc, minSize, maxSize ?? undefined);
    const result = new Map<K, V>();
    while (collection.more()) {
      tc.startSpan(Labels.MAP_ENTRY);
      const key = keys.doDraw(tc);
      const value = values.doDraw(tc);
      tc.stopSpan(false);
      if (result.has(key)) {
        collection.reject("duplicate key");
        continue;
      }
      result.set(key, value);
    }
    tc.stopSpan(false);
    return result;
  });
}

export { maps as dicts };

// ---------------------------------------------------------------------------
// OneOf
// ---------------------------------------------------------------------------

/** Choose from multiple generators of the same type. */
export function oneOf<T>(...generators: Generator<T>[]): Generator<T> {
  if (generators.length === 0) {
    throw new Error("oneOf requires at least one generator");
  }

  const basics = generators.map((g) => g.asBasic());
  if (basics.every((b) => b !== null)) {
    const validBasics = basics as BasicGenerator<T>[];

    const taggedSchemas = validBasics.map((b, i) => ({
      type: "tuple",
      elements: [{ type: "constant", value: i }, b.schema],
    }));

    return new BasicGenerator({ type: "one_of", generators: taggedSchemas }, (raw) => {
      if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
      const tag = raw[0] as number;
      return validBasics[tag].parseRaw(raw[1]);
    });
  }

  return new CompositeGenerator((tc) => {
    tc.startSpan(Labels.ONE_OF);
    const index = integers({ minValue: 0, maxValue: generators.length - 1 }).doDraw(tc);
    const result = generators[index].doDraw(tc);
    tc.stopSpan(false);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Optional
// ---------------------------------------------------------------------------

/** Generate either a value from the inner generator, or null. */
export function optional<T>(inner: Generator<T>): Generator<T | null> {
  const innerBasic = inner.asBasic();
  if (innerBasic) {
    const nullSchema = {
      type: "tuple",
      elements: [{ type: "constant", value: 0 }, { type: "null" }],
    };
    const valueSchema = {
      type: "tuple",
      elements: [{ type: "constant", value: 1 }, innerBasic.schema],
    };

    return new BasicGenerator({ type: "one_of", generators: [nullSchema, valueSchema] }, (raw) => {
      if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
      const tag = raw[0] as number;
      if (tag === 0) return null;
      return innerBasic.parseRaw(raw[1]);
    });
  }

  return new CompositeGenerator((tc) => {
    tc.startSpan(Labels.OPTIONAL);
    const isSome = generateRaw(tc, { type: "boolean" }) as boolean;
    const result = isSome ? inner.doDraw(tc) : null;
    tc.stopSpan(false);
    return result;
  });
}

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

  return new CompositeGenerator((tc) => {
    tc.startSpan(Labels.TUPLE);
    const result = generators.map((g) => g.doDraw(tc));
    tc.stopSpan(false);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Format generators
// ---------------------------------------------------------------------------

/** Generate email addresses. */
export function emails(): BasicGenerator<string> {
  return new BasicGenerator({ type: "email" }, (raw) => String(raw));
}

/** Generate URLs. */
export function urls(): BasicGenerator<string> {
  return new BasicGenerator({ type: "url" }, (raw) => String(raw));
}

export interface DomainOptions {
  /** Maximum length (must be between 4 and 255, default 255). */
  maxLength?: number;
}

/** Generate domain names. */
export function domains(options?: DomainOptions): BasicGenerator<string> {
  const schema: Record<string, unknown> = { type: "domain" };
  if (options?.maxLength !== undefined) {
    schema["max_length"] = options.maxLength;
  }
  return new BasicGenerator(schema, (raw) => String(raw));
}

/** Generate IPv4 address strings. */
export function ipv4Addresses(): BasicGenerator<string> {
  return new BasicGenerator({ type: "ipv4" }, (raw) => String(raw));
}

/** Generate IPv6 address strings. */
export function ipv6Addresses(): BasicGenerator<string> {
  return new BasicGenerator({ type: "ipv6" }, (raw) => String(raw));
}

/** Generate IP address strings (IPv4 or IPv6). */
export function ipAddresses(): Generator<string> {
  return oneOf(ipv4Addresses(), ipv6Addresses());
}

/** Generate date strings (ISO 8601). */
export function dates(): BasicGenerator<string> {
  return new BasicGenerator({ type: "date" }, (raw) => String(raw));
}

/** Generate time strings (ISO 8601). */
export function times(): BasicGenerator<string> {
  return new BasicGenerator({ type: "time" }, (raw) => String(raw));
}

/** Generate datetime strings (ISO 8601). */
export function datetimes(): BasicGenerator<string> {
  return new BasicGenerator({ type: "datetime" }, (raw) => String(raw));
}

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

/** Create a generator from an imperative function. */
export function composite<T>(fn: (tc: TestCase) => T): Generator<T> {
  return new CompositeGenerator(fn);
}

// ---------------------------------------------------------------------------
// Record generator
// ---------------------------------------------------------------------------

type RecordSchema<T> = { [K in keyof T]: Generator<T[K]> };

/**
 * Generate plain objects by drawing each field from its generator.
 *
 * @example
 * ```ts
 * const userGen = recordGenerator({
 *   name: text(),
 *   age: integers({ minValue: 0, maxValue: 120 }),
 * });
 * ```
 */
export function recordGenerator<T extends Record<string, unknown>>(
  schema: RecordSchema<T>,
): Generator<T> {
  const keys = Object.keys(schema) as (keyof T & string)[];
  const generators = keys.map((k) => schema[k]);

  const basics = generators.map((g) => g.asBasic());
  if (basics.every((b) => b !== null)) {
    const validBasics = basics as BasicGenerator<unknown>[];
    return new BasicGenerator(
      { type: "tuple", elements: validBasics.map((b) => b.schema) },
      (raw) => {
        if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < keys.length; i++) {
          obj[keys[i]] = validBasics[i].parseRaw(raw[i]);
        }
        return obj as T;
      },
    ) as Generator<T>;
  }

  return new CompositeGenerator((tc: TestCase) => {
    tc.startSpan(Labels.FIXED_DICT);
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < keys.length; i++) {
      obj[keys[i]] = generators[i].doDraw(tc);
    }
    tc.stopSpan(false);
    return obj as T;
  });
}

// ---------------------------------------------------------------------------
// Variant generator
// ---------------------------------------------------------------------------

/**
 * Generate discriminated unions by picking a variant and drawing its fields.
 *
 * @param variants - Map from variant tag to generator (or null for data-less variants).
 * @param discriminant - The discriminant field name (default: "type").
 *
 * @example
 * ```ts
 * type Shape =
 *   | { type: 'circle'; radius: number }
 *   | { type: 'rectangle'; width: number; height: number }
 *   | { type: 'point' };
 *
 * const shapeGen = variantGenerator<Shape>({
 *   circle: recordGenerator({ radius: floats({ minValue: 0 }) }),
 *   rectangle: recordGenerator({ width: floats({ minValue: 0 }), height: floats({ minValue: 0 }) }),
 *   point: null,
 * });
 * ```
 */
export function variantGenerator<T>(
  variants: Record<string, Generator<Record<string, unknown>> | null>,
  discriminant = "type",
): Generator<T> {
  const tags = Object.keys(variants);
  if (tags.length === 0) {
    throw new Error("variantGenerator requires at least one variant");
  }

  const tagGen = sampledFrom(tags);

  return new CompositeGenerator((tc: TestCase) => {
    tc.startSpan(Labels.ENUM_VARIANT);
    const tag = tagGen.doDraw(tc);
    const gen = variants[tag];
    let obj: Record<string, unknown>;
    if (gen) {
      obj = { [discriminant]: tag, ...gen.doDraw(tc) };
    } else {
      obj = { [discriminant]: tag };
    }
    tc.stopSpan(false);
    return obj as T;
  });
}

// Re-export StopTestError for use in generators
export { StopTestError };
