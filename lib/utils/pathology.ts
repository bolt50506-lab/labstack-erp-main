export type ResultFlag = 'normal' | 'low' | 'high' | 'critical';

/**
 * Parses a free-text reference range like "13.0 - 17.0" or "13-17" into
 * numeric bounds. Returns null if the text doesn't look like a simple range.
 */
export function parseRange(range: string | null | undefined): { low: number; high: number } | null {
  if (!range) return null;
  const match = range.match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const low = parseFloat(match[1]);
  const high = parseFloat(match[2]);
  if (Number.isNaN(low) || Number.isNaN(high)) return null;
  return { low, high };
}

/**
 * Computes a result flag from a result value against a reference range and
 * optional critical thresholds. Returns null when the value or range can't
 * be parsed numerically (e.g. free-text results), so callers can fall back
 * to a manual flag in that case.
 */
export function computeFlag(
  resultValue: string,
  normalRange: string | null | undefined,
  lowCritical?: number | null,
  highCritical?: number | null
): ResultFlag | null {
  const value = parseFloat(resultValue);
  if (Number.isNaN(value)) return null;

  if (lowCritical != null && value < lowCritical) return 'critical';
  if (highCritical != null && value > highCritical) return 'critical';

  const range = parseRange(normalRange);
  if (!range) return null;
  if (value < range.low) return 'low';
  if (value > range.high) return 'high';
  return 'normal';
}
