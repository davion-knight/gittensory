// Fleet-wide confidence-vs-outcome calibration (#2192): the global analog of ops.ts's per-agent
// `computeCalibration`, aggregated across EVERY project so the maintainer analytics dashboard can render a single
// calibration card (the operator-dashboard payload is install-global, not per-agent). Pure read (D1 only); fails
// safe to an empty result on any read error. The binning/summary fold is the engine's deterministic
// `computeCalibrationBins`; this module only fetches the merged-PR confidence + reversal signals it needs.
import {
  computeCalibrationBins,
  type CalibrationBinsResult,
  type CalibrationSample,
} from "../../packages/gittensory-engine/src/calibration-bins";

/** Read a merge-confidence out of a target's stored `decision_json`; null when absent/unparseable/non-numeric. */
function parseConfidence(decisionJson: string | null): number | null {
  if (!decisionJson) return null;
  try {
    const c = (JSON.parse(decisionJson) as { confidence?: unknown }).confidence;
    return typeof c === "number" ? c : null;
  } catch {
    return null;
  }
}

/**
 * Aggregate every merged PR's predicted-merge confidence against whether it was later reverted, across all
 * projects, into calibration bins + a recommended floor. Windowed by `days` (clamped 1..730, default 90).
 */
export async function computeGlobalCalibration(
  env: Env,
  opts: { days: number; nowMs: number },
): Promise<CalibrationBinsResult> {
  const days =
    Number.isFinite(opts.days) && opts.days > 0 ? Math.min(opts.days, 730) : 90;
  const fromIso = new Date(opts.nowMs - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  try {
    const rows = await env.DB.prepare(
      `SELECT t.id AS id, t.decision_json AS decision_json,
              CASE WHEN r.target_id IS NOT NULL THEN 1 ELSE 0 END AS reverted
       FROM review_targets t
       LEFT JOIN (
         SELECT DISTINCT target_id FROM review_audit WHERE event_type IN ('reversal_reverted', 'reversal_reopened')
       ) r ON r.target_id = t.id
       WHERE t.status = 'merged' AND t.created_at >= ?`,
    )
      .bind(fromIso)
      .all<{ id: string; decision_json: string | null; reverted: number }>();
    const samples: CalibrationSample[] = [];
    for (const row of rows.results ?? []) {
      const confidence = parseConfidence(row.decision_json);
      if (confidence === null) continue;
      samples.push({ confidence, reverted: row.reverted === 1 });
    }
    return computeCalibrationBins(samples);
  } catch {
    return computeCalibrationBins([]);
  }
}
