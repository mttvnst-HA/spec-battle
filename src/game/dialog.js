import { pick } from "./rng.js";

/**
 * Normalize a move name to its `vs_*` bucket key. Replaces both spaces and
 * hyphens with underscores; preserves case. Matches the normalization that
 * content-loader applies when it validates quote bucket keys.
 */
export function vsKey(moveName) {
  return "vs_" + moveName.replace(/[ -]/g, "_");
}

/**
 * Select a quote string for the given attacker, move, and context.
 *
 * Selection priority:
 *   1. If isOpening and move.quotes.opening is a non-empty array → pick from it.
 *   2. Else if opponentLastMove and move.quotes[vsKey(opponentLastMove)] is a
 *      non-empty array → pick from it.
 *   3. Else → pick from move.quotes.default.
 *
 * Legacy backward-compat: if move.quotes is a flat array (not an object),
 * treat it as the default pool.
 */
export function pickDialog({ attackerSide, move, opponentLastMove, isOpening }) {
  const q = move.quotes;

  // Legacy flat-array shape.
  if (Array.isArray(q)) {
    return pick(q);
  }

  if (isOpening && Array.isArray(q.opening) && q.opening.length > 0) {
    return pick(q.opening);
  }

  if (opponentLastMove) {
    const bucket = q[vsKey(opponentLastMove)];
    if (Array.isArray(bucket) && bucket.length > 0) {
      return pick(bucket);
    }
  }

  return pick(q.default);
}
