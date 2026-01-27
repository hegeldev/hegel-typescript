import { generateFromSchema } from "./connection.js"
import { Generator, JsonSchema, FuncGenerator } from "./generator.js"

/**
 * Base class for format string generators.
 */
abstract class FormatGenerator implements Generator<string> {
  protected abstract getSchema(): JsonSchema

  generate(): string {
    return generateFromSchema<string>(this.schema())
  }

  schema(): JsonSchema {
    return this.getSchema()
  }

  map<U>(f: (value: string) => U): Generator<U> {
    return new FuncGenerator(() => f(this.generate()))
  }

  flatMap<U>(f: (value: string) => Generator<U>): Generator<U> {
    return new FuncGenerator(() => f(this.generate()).generate())
  }

  filter(predicate: (value: string) => boolean, maxAttempts = 3): Generator<string> {
    return new FuncGenerator(() => {
      for (let i = 0; i < maxAttempts; i++) {
        const value = this.generate()
        if (predicate(value)) return value
      }
      throw new Error(`filter: failed after ${maxAttempts} attempts`)
    })
  }
}

/**
 * Generator for email addresses.
 */
class EmailGenerator extends FormatGenerator {
  protected getSchema(): JsonSchema {
    return { type: "email" }
  }
}

/**
 * Create a generator for email addresses.
 */
export function emails(): Generator<string> {
  return new EmailGenerator()
}

/**
 * Generator for URLs.
 */
class UrlGenerator extends FormatGenerator {
  protected getSchema(): JsonSchema {
    return { type: "url" }
  }
}

/**
 * Create a generator for URLs.
 */
export function urls(): Generator<string> {
  return new UrlGenerator()
}

/**
 * Generator for domain names with optional max length.
 */
export class DomainGenerator implements Generator<string> {
  private constructor(private readonly _maxLength: number = 255) {}

  static create(): DomainGenerator {
    return new DomainGenerator()
  }

  /**
   * Set the maximum length for the domain.
   */
  maxLength(value: number): DomainGenerator {
    return new DomainGenerator(value)
  }

  generate(): string {
    return generateFromSchema<string>(this.schema())
  }

  schema(): JsonSchema {
    return {
      type: "domain",
      max_length: this._maxLength,
    }
  }

  map<U>(f: (value: string) => U): Generator<U> {
    return new FuncGenerator(() => f(this.generate()))
  }

  flatMap<U>(f: (value: string) => Generator<U>): Generator<U> {
    return new FuncGenerator(() => f(this.generate()).generate())
  }

  filter(predicate: (value: string) => boolean, maxAttempts = 3): Generator<string> {
    return new FuncGenerator(() => {
      for (let i = 0; i < maxAttempts; i++) {
        const value = this.generate()
        if (predicate(value)) return value
      }
      throw new Error(`filter: failed after ${maxAttempts} attempts`)
    })
  }
}

/**
 * Create a generator for domain names.
 */
export function domains(): DomainGenerator {
  return DomainGenerator.create()
}

/**
 * IP address version.
 */
type IpVersion = "v4" | "v6" | "any"

/**
 * Generator for IP addresses.
 */
export class IpAddressGenerator implements Generator<string> {
  private constructor(private readonly _version: IpVersion = "any") {}

  static create(): IpAddressGenerator {
    return new IpAddressGenerator()
  }

  /**
   * Generate only IPv4 addresses.
   */
  v4(): IpAddressGenerator {
    return new IpAddressGenerator("v4")
  }

  /**
   * Generate only IPv6 addresses.
   */
  v6(): IpAddressGenerator {
    return new IpAddressGenerator("v6")
  }

  generate(): string {
    return generateFromSchema<string>(this.schema())
  }

  schema(): JsonSchema {
    switch (this._version) {
      case "v4":
        return { type: "ipv4" }
      case "v6":
        return { type: "ipv6" }
      default:
        return {
          one_of: [{ type: "ipv4" }, { type: "ipv6" }],
        }
    }
  }

  map<U>(f: (value: string) => U): Generator<U> {
    return new FuncGenerator(() => f(this.generate()))
  }

  flatMap<U>(f: (value: string) => Generator<U>): Generator<U> {
    return new FuncGenerator(() => f(this.generate()).generate())
  }

  filter(predicate: (value: string) => boolean, maxAttempts = 3): Generator<string> {
    return new FuncGenerator(() => {
      for (let i = 0; i < maxAttempts; i++) {
        const value = this.generate()
        if (predicate(value)) return value
      }
      throw new Error(`filter: failed after ${maxAttempts} attempts`)
    })
  }
}

/**
 * Create a generator for IP addresses.
 */
export function ipAddresses(): IpAddressGenerator {
  return IpAddressGenerator.create()
}

/**
 * Generator for date strings (YYYY-MM-DD format).
 */
class DateGenerator extends FormatGenerator {
  protected getSchema(): JsonSchema {
    return { type: "date" }
  }
}

/**
 * Create a generator for date strings (ISO 8601 date format).
 */
export function dates(): Generator<string> {
  return new DateGenerator()
}

/**
 * Generator for time strings (HH:MM:SS format).
 */
class TimeGenerator extends FormatGenerator {
  protected getSchema(): JsonSchema {
    return { type: "time" }
  }
}

/**
 * Create a generator for time strings (ISO 8601 time format).
 */
export function times(): Generator<string> {
  return new TimeGenerator()
}

/**
 * Generator for datetime strings (ISO 8601 format).
 */
class DateTimeGenerator extends FormatGenerator {
  protected getSchema(): JsonSchema {
    return { type: "datetime" }
  }
}

/**
 * Create a generator for datetime strings (ISO 8601 datetime format).
 */
export function datetimes(): Generator<string> {
  return new DateTimeGenerator()
}
