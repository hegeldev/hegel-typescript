/**
 * Hegel property-based testing SDK for TypeScript.
 *
 * @packageDocumentation
 */

/** Returns the version of the Hegel TypeScript SDK. */
export function version(): string {
  return "0.1.0";
}

export type { Packet } from "./protocol.js";
export {
  PROTOCOL_VERSION,
  MAGIC,
  REPLY_BIT,
  TERMINATOR,
  CLOSE_CHANNEL_MESSAGE_ID,
  CLOSE_CHANNEL_PAYLOAD,
  PartialPacketError,
  ConnectionClosedError,
  SocketIdleTimeoutError,
  recvExact,
  readPacket,
  writePacket,
  encodeValue,
  decodeValue,
  extractInt,
  extractFloat,
  extractString,
  extractBool,
  extractBytes,
  extractList,
  extractDict,
} from "./protocol.js";

export {
  ConnectionState,
  Connection,
  Channel,
  RequestError,
  PendingRequest,
  resultOrError,
  SHUTDOWN,
} from "./connection.js";

export {
  AssumeRejected,
  AssertionError,
  ConnectionError,
  DataExhausted,
  RuntimeError,
  Labels,
  Client,
  extractOrigin,
  generateFromSchema,
  assume,
  note,
  target,
  startSpan,
  stopSpan,
} from "./runner.js";

export { runHegelTest, hegel, HegelSession } from "./session.js";

export {
  Generator,
  BasicGenerator,
  MappedGenerator,
  FlatMappedGenerator,
  FilteredGenerator,
  CompositeTupleGenerator,
  Collection,
  CompositeListGenerator,
  group,
  discardableGroup,
  integers,
  floats,
  booleans,
  text,
  binary,
  just,
  sampledFrom,
  fromRegex,
  emails,
  urls,
  domains,
  dates,
  times,
  datetimes,
  lists,
  tuples2,
  tuples3,
  tuples4,
  CompositeOneOfGenerator,
  oneOf,
  optional,
  ipAddresses,
  CompositeDictGenerator,
  dicts,
} from "./generators.js";

export {
  field,
  DerivedGenerator,
  deriveGenerator,
  RecordDerivedGenerator,
  recordGenerator,
  VariantGenerator,
  variantGenerator,
} from "./derive.js";

export type { VariantDef, FieldMeta } from "./derive.js";

export { getTestCases, writeMetrics } from "./conformance.js";
