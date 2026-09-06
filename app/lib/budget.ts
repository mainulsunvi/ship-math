/**
 * Byte budget for the mirrored function configuration (architecture.md §A1,
 * review 004/005: single source for the cap so server and UI cannot drift).
 *
 * The checkout Function receives `null` for metafield values above 10,000
 * bytes; the server enforces this soft cap with headroom when building the
 * config, and the rules UI quotes it in the advisory size tooltip. PURE
 * module: constants only, zero imports — safe on both server and client.
 */

/** Soft cap (bytes) for the primary `function-configuration` metafield. */
export const SOFT_CAP_BYTES = 9500;
