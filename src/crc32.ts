/**
 * CRC32 (IEEE 802.3 / ISO-HDLC, polynomial 0xEDB88320).
 *
 * Vendored so the library works on Node versions older than 22.2.0.
 */

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

/**
 * Compute the CRC32 checksum of a byte buffer.
 *
 * @param data - The bytes to checksum.
 * @returns The CRC32 as an unsigned 32-bit integer.
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
