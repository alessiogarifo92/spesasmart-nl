/**
 * Outcome of a parser or calculation that can fail on real-world input.
 * `ok: false` carries a machine-readable reason; it never carries a guessed value.
 */
export type Result<T, R extends string> = { ok: true; value: T } | { ok: false; reason: R };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function fail<R extends string>(reason: R): { ok: false; reason: R } {
  return { ok: false, reason };
}
