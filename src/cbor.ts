/**
 * CBOR codec configured for the Hegel value encoding.
 *
 * libhegel returns generated strings (and the string-shaped format generators:
 * emails, urls, domains, dates, …) as a CBOR **tag 91** wrapping WTF-8 bytes,
 * so that lone surrogates survive the round trip. Registering the tag-91
 * extension here — and routing all schema encoding / value decoding through
 * this module's {@link encode} / {@link decode} — makes those values decode to
 * JS strings everywhere.
 *
 * @packageDocumentation
 */

// Deno only added the `Buffer` global in 2.4
import { Buffer } from "node:buffer";
import { addExtension, encode, decode } from "cbor-x";
import { wtf8ToString } from "./wtf8.js";

// `addExtension` mutates cbor-x's global tag registry, so registering it once
// at module load configures every subsequent `decode` call in the process.
addExtension({
  // cbor-x requires a Class for the extension, but tag 91 is only ever
  // received (decoded), never produced by the client — so the encode path is
  // unreachable.
  /* v8 ignore start */
  Class: class HegelString {},
  encode: () => Buffer.alloc(0),
  /* v8 ignore stop */
  tag: 91,
  // The tag-91 payload is always a CBOR byte string, which cbor-x decodes to a
  // Buffer; `wtf8ToString` also accepts a plain Uint8Array view.
  decode: (data: Uint8Array): string => wtf8ToString(data as Buffer),
});

export { encode, decode };
