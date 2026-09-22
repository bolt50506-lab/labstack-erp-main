export type WestgardFlag = 'pass' | 'warning' | 'fail';

export type QcPoint = { value: number; zScore: number };

/**
 * Evaluates the most recent QC point against its run history using the
 * common Westgard multi-rule set:
 * - 1-2s: one point beyond 2SD — warning only, inspect further rules
 * - 1-3s: one point beyond 3SD — reject
 * - 2-2s: two consecutive points beyond 2SD on the same side — reject
 * - R-4s: two consecutive points on opposite sides, ranging >4SD apart — reject
 * - 4-1s: four consecutive points beyond 1SD on the same side — reject
 * history should be ordered oldest-to-newest and NOT include the new point.
 */
export function evaluateWestgard(newZScore: number, historyZScores: number[]): { flag: WestgardFlag; rule: string | null } {
  const abs = Math.abs(newZScore);

  if (abs > 3) return { flag: 'fail', rule: '1-3s' };

  const prev = historyZScores[historyZScores.length - 1];
  if (prev !== undefined) {
    if (Math.abs(prev) > 2 && abs > 2 && Math.sign(prev) === Math.sign(newZScore)) {
      return { flag: 'fail', rule: '2-2s' };
    }
    if (Math.sign(prev) !== Math.sign(newZScore) && Math.abs(prev - newZScore) > 4) {
      return { flag: 'fail', rule: 'R-4s' };
    }
  }

  const lastThree = [...historyZScores.slice(-3), newZScore];
  if (lastThree.length === 4 && (lastThree.every(z => z > 1) || lastThree.every(z => z < -1))) {
    return { flag: 'fail', rule: '4-1s' };
  }

  if (abs > 2) return { flag: 'warning', rule: '1-2s' };

  return { flag: 'pass', rule: null };
}

export function computeZScore(value: number, mean: number, sd: number): number {
  if (sd === 0) return 0;
  return (value - mean) / sd;
}
