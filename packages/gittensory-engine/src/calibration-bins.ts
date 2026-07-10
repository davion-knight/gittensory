// Confidence-vs-outcome calibration bins (#2192). Pure fold over a series of merged-PR samples (each a
// predicted-merge confidence + whether a human later reverted the auto-merge) into fixed 0–100% confidence
// buckets with a realized kept-rate per bucket, plus the fleet-wide kept/reverted confidence summary and a
// recommended confidence floor. This is the deterministic core the maintainer analytics "calibration" card
// renders; the review stack fetches the raw samples (D1) and calls this — no IO/Date/randomness here, matching
// the engine's side-effect-free contract. Public-safe: only confidence values, counts, and a floor (no scores).

/** One merged-PR observation: the gate's predicted merge confidence and whether a human later reverted it. */
export interface CalibrationSample {
  /** Predicted merge confidence in [0, 1]. */
  confidence: number;
  /** True if the auto-merge was later reverted/reopened by a human. */
  reverted: boolean;
}

/** One fixed confidence bucket and the realized outcome of merges that fell in it. */
export interface CalibrationConfidenceBin {
  /** Inclusive lower bound of the bucket, in whole percent (0, 10, …, 90). */
  lowerPct: number;
  /** Exclusive upper bound, in whole percent (10, 20, …, 100). */
  upperPct: number;
  merged: number;
  reverted: number;
  /** (merged − reverted) / merged; null when the bucket is empty (nothing to be calibrated about). */
  keptRate: number | null;
}

export interface CalibrationBinsResult {
  /** Always ten buckets, 0–10% … 90–100%, low to high. */
  bins: CalibrationConfidenceBin[];
  /** Samples carrying a usable confidence reading. */
  mergedCount: number;
  revertedCount: number;
  /** Mean confidence of merges that were NOT reverted; null when there are none. */
  keptAvgConfidence: number | null;
  /** Highest confidence at which a merge was still reverted; null when nothing was reverted. */
  revertedMaxConfidence: number | null;
  /** The floor that would have sat just above the highest reverted merge (revertedMax + 0.02, capped 0.99);
   *  null when no merge was reverted, i.e. the current calibration looks adequate. */
  recommendedFloor: number | null;
  /** True once there are enough samples to read the curve meaningfully. */
  hasSignal: boolean;
}

const BIN_COUNT = 10;
/** Below this many samples the per-bucket kept-rates are too noisy to read. */
const MIN_SAMPLES_FOR_SIGNAL = 10;

function round3(value: number): number {
  return Number(value.toFixed(3));
}

/** Fold merged-PR samples into confidence buckets + a calibration summary. Pure and deterministic. */
export function computeCalibrationBins(
  samples: readonly CalibrationSample[],
): CalibrationBinsResult {
  const bins: CalibrationConfidenceBin[] = Array.from(
    { length: BIN_COUNT },
    (_, i) => ({
      lowerPct: i * 10,
      upperPct: i * 10 + 10,
      merged: 0,
      reverted: 0,
      keptRate: null,
    }),
  );

  const kept: number[] = [];
  const revertedConfidences: number[] = [];
  for (const s of samples) {
    // clamp so a boundary confidence of exactly 1 lands in the top bucket rather than overflowing.
    const idx = Math.min(
      BIN_COUNT - 1,
      Math.max(0, Math.floor(s.confidence * BIN_COUNT)),
    );
    const bin = bins[idx]!;
    bin.merged += 1;
    if (s.reverted) {
      bin.reverted += 1;
      revertedConfidences.push(s.confidence);
    } else {
      kept.push(s.confidence);
    }
  }
  for (const bin of bins) {
    if (bin.merged > 0)
      bin.keptRate = round3((bin.merged - bin.reverted) / bin.merged);
  }

  const mergedCount = samples.length;
  const revertedCount = revertedConfidences.length;
  const keptAvgConfidence = kept.length
    ? round3(kept.reduce((a, b) => a + b, 0) / kept.length)
    : null;
  const revertedMaxConfidence = revertedConfidences.length
    ? Math.max(...revertedConfidences)
    : null;
  const recommendedFloor =
    revertedMaxConfidence === null
      ? null
      : round3(Math.min(0.99, revertedMaxConfidence + 0.02));

  return {
    bins,
    mergedCount,
    revertedCount,
    keptAvgConfidence,
    revertedMaxConfidence,
    recommendedFloor,
    hasSignal: mergedCount >= MIN_SAMPLES_FOR_SIGNAL,
  };
}
