/**
 * String, character, binary, regex, and format generators.
 *
 * @packageDocumentation
 */

import { TestCase, generateRaw } from "../testCase.js";
import { Generator, BasicGenerator } from "./core.js";
import { oneOf } from "./combinators.js";

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
  categories?: readonly string[];
  /** Exclude characters from these Unicode general categories. */
  excludeCategories?: readonly string[];
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

function parseString(raw: unknown): string {
  return String(raw);
}

function parseBytes(raw: unknown): Uint8Array {
  // Buffer is a subclass of Uint8Array, so this catches both.
  if (raw instanceof Uint8Array) return raw;
  throw new Error(`Expected bytes, got ${typeof raw}`);
}

/**
 * Convenience base for generators that are pure schema+parse wrappers.
 * Subclasses supply a schema in the constructor; doDraw and asBasic use it.
 */
abstract class SchemaStringGenerator extends Generator<string> {
  protected readonly schema: Record<string, unknown>;

  constructor(schema: Record<string, unknown>) {
    super();
    this.schema = schema;
  }

  doDraw(tc: TestCase): string {
    return parseString(generateRaw(tc, this.schema));
  }

  override asBasic(): BasicGenerator<string> {
    return new BasicGenerator(this.schema, parseString);
  }
}

class TextGenerator extends SchemaStringGenerator {
  constructor(options?: TextOptions) {
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
    super(schema);
  }
}

/** Generate text strings. */
export function text(options?: TextOptions): Generator<string> {
  return new TextGenerator(options);
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export type CharacterOptions = CharacterFilterOptions;

class CharactersGenerator extends SchemaStringGenerator {
  constructor(options?: CharacterOptions) {
    const schema: Record<string, unknown> = {
      type: "string",
      min_size: 1,
      max_size: 1,
    };
    if (options) {
      Object.assign(schema, buildCharacterSchema(options));
    }
    super(schema);
  }
}

/** Generate single characters. */
export function characters(options?: CharacterOptions): Generator<string> {
  return new CharactersGenerator(options);
}

export interface BinaryOptions {
  minSize?: number;
  maxSize?: number;
}

class BinaryGenerator extends Generator<Uint8Array> {
  private readonly schema: Record<string, unknown>;

  constructor(options?: BinaryOptions) {
    super();
    const schema: Record<string, unknown> = {
      type: "binary",
      min_size: options?.minSize ?? 0,
    };
    if (options?.maxSize !== undefined) {
      schema["max_size"] = options.maxSize;
    }
    this.schema = schema;
  }

  doDraw(tc: TestCase): Uint8Array {
    return parseBytes(generateRaw(tc, this.schema));
  }

  override asBasic(): BasicGenerator<Uint8Array> {
    return new BasicGenerator(this.schema, parseBytes);
  }
}

/** Generate binary data (Uint8Array). */
export function binary(options?: BinaryOptions): Generator<Uint8Array> {
  return new BinaryGenerator(options);
}

export interface RegexOptions {
  fullmatch?: boolean;
}

class FromRegexGenerator extends SchemaStringGenerator {
  constructor(pattern: string, options?: RegexOptions) {
    super({
      type: "regex",
      pattern,
      fullmatch: options?.fullmatch ?? false,
    });
  }
}

/** Generate strings matching a regex pattern. Defaults to substring match. */
export function fromRegex(pattern: string, options?: RegexOptions): Generator<string> {
  return new FromRegexGenerator(pattern, options);
}

class EmailsGenerator extends SchemaStringGenerator {
  constructor() {
    super({ type: "email" });
  }
}

/** Generate email addresses. */
export function emails(): Generator<string> {
  return new EmailsGenerator();
}

class UrlsGenerator extends SchemaStringGenerator {
  constructor() {
    super({ type: "url" });
  }
}

/** Generate URLs. */
export function urls(): Generator<string> {
  return new UrlsGenerator();
}

export interface DomainOptions {
  /** Maximum length (must be between 4 and 255, default 255). */
  maxLength?: number;
}

class DomainsGenerator extends SchemaStringGenerator {
  constructor(options?: DomainOptions) {
    const schema: Record<string, unknown> = { type: "domain" };
    if (options?.maxLength !== undefined) {
      schema["max_length"] = options.maxLength;
    }
    super(schema);
  }
}

/** Generate domain names. */
export function domains(options?: DomainOptions): Generator<string> {
  return new DomainsGenerator(options);
}

export interface IpAddressOptions {
  /** Restrict to a specific IP version. Omit to generate either IPv4 or IPv6. */
  version?: 4 | 6;
}

class IpAddressesGenerator extends SchemaStringGenerator {
  constructor(version: 4 | 6) {
    super({ type: "ip_address", version });
  }
}

/** Generate IP address strings. Defaults to either IPv4 or IPv6; pass `{ version }` to restrict. */
export function ipAddresses(options?: IpAddressOptions): Generator<string> {
  if (options?.version === 4) return new IpAddressesGenerator(4);
  if (options?.version === 6) return new IpAddressesGenerator(6);
  return oneOf(new IpAddressesGenerator(4), new IpAddressesGenerator(6));
}

class DatesGenerator extends SchemaStringGenerator {
  constructor() {
    super({ type: "date" });
  }
}

/** Generate date strings (ISO 8601). */
export function dates(): Generator<string> {
  return new DatesGenerator();
}

class TimesGenerator extends SchemaStringGenerator {
  constructor() {
    super({ type: "time" });
  }
}

/** Generate time strings (ISO 8601). */
export function times(): Generator<string> {
  return new TimesGenerator();
}

class DatetimesGenerator extends SchemaStringGenerator {
  constructor() {
    super({ type: "datetime" });
  }
}

/** Generate datetime strings (ISO 8601). */
export function datetimes(): Generator<string> {
  return new DatetimesGenerator();
}
