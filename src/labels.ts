/**
 * Label constants for span management.
 * These help Hegel understand data structure for better shrinking.
 */
export const LABELS = {
  LIST: 1,
  LIST_ELEMENT: 2,
  SET: 3,
  SET_ELEMENT: 4,
  MAP: 5,
  MAP_ENTRY: 6,
  TUPLE: 7,
  ONE_OF: 8,
  OPTIONAL: 9,
  FIXED_OBJECT: 10,
  FLAT_MAP: 11,
  FILTER: 12,
  SAMPLED_FROM: 13,
} as const

export type Label = (typeof LABELS)[keyof typeof LABELS]
