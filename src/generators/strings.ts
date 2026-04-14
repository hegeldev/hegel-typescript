/**
 * String, character, binary, regex, and format generators.
 *
 * @packageDocumentation
 */

import { BasicGenerator, Generator } from "./core.js";
import { oneOf } from "./combinators.js";

// ---------------------------------------------------------------------------
// Character filtering
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

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

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
