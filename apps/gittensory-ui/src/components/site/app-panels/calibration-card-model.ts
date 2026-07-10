// Confidence-calibration analytics card model (#2192). UI-side mirror of the CalibrationBinsResult shape produced
// by computeGlobalCalibration (src/review/global-calibration.ts) and surfaced on the operator-dashboard payload,
// plus the pure fold the card renders. Types + pure helper live here (not the .tsx) so the component file exports
// only components (react-refresh/only-export-components).

/** One fixed confidence bucket and the realized outcome of merges that fell in it. */
export interface CalibrationConfidenceBin {
  lowerPct: number;
  upperPct: number;
  merged: number;
  reverted: number;
  keptRate: number | null;
}

/** The calibration payload as delivered on the operator-dashboard (mirror of the engine's CalibrationBinsResult). */
export interface CalibrationBinsResult {
  bins: CalibrationConfidenceBin[];
  mergedCount: number;
  revertedCount: number;
  keptAvgConfidence: number | null;
  revertedMaxConfidence: number | null;
  recommendedFloor: number | null;
  hasSignal: boolean;
}

export interface CalibrationSummary {
  /** Largest per-bucket merged count — the denominator for scaling each row's bar. */
  maxBinMerged: number;
  /** The highest-confidence bucket that still had a reverted merge (keptRate < 1); null when everything stuck. */
  overconfidentBin: CalibrationConfidenceBin | null;
}

/** Fold the bins into the two derived values the card needs: a bar scale and the worst overconfident bucket.
 *  Pure; an all-kept (or empty) result yields a null overconfident bucket. */
export function summarizeCalibration(result: CalibrationBinsResult): CalibrationSummary {
  let maxBinMerged = 0;
  let overconfidentBin: CalibrationConfidenceBin | null = null;
  for (const bin of result.bins) {
    if (bin.merged > maxBinMerged) maxBinMerged = bin.merged;
    // bins run low→high, so the last one that carries a revert is the highest-confidence overconfidence.
    if (bin.merged > 0 && bin.keptRate !== null && bin.keptRate < 1) overconfidentBin = bin;
  }
  return { maxBinMerged, overconfidentBin };
}
