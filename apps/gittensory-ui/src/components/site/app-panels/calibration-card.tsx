import { cn } from "@/lib/utils";
import { Stat, StatusPill } from "@/components/site/control-primitives";
import {
  summarizeCalibration,
  type CalibrationBinsResult,
  type CalibrationConfidenceBin,
} from "./calibration-card-model";

const pct = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

/** Self-host maintainer analytics card (#2192): predicted merge confidence vs. the realized kept-rate per bucket,
 *  plus the recommended confidence floor, read-only over the operator-dashboard payload. Renders nothing until at
 *  least one merge has a confidence reading (keeps the analytics page clean on a fresh install). */
export function CalibrationCard({ calibration }: { calibration: CalibrationBinsResult }) {
  if (calibration.mergedCount === 0) return null;
  const { maxBinMerged, overconfidentBin } = summarizeCalibration(calibration);
  return (
    <section className="rounded-token border border-border bg-transparent p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-token-lg font-semibold">Confidence calibration</h2>
          <p className="mt-1 text-token-xs text-muted-foreground">
            Predicted merge confidence vs. the realized kept-rate — how often an auto-merge stuck
            rather than being reverted. Public-safe counts only.
          </p>
        </div>
        <StatusPill status={calibration.hasSignal ? "ready" : "warn"}>
          {calibration.hasSignal ? `${calibration.mergedCount} merges` : "below sample floor"}
        </StatusPill>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Stat
          label="Recommended floor"
          value={pct(calibration.recommendedFloor)}
          hint={
            <span className="text-muted-foreground">
              {calibration.recommendedFloor !== null
                ? "a higher-confidence merge was still reverted"
                : "the current floor looks adequate"}
            </span>
          }
        />
        <Stat
          label="Avg kept confidence"
          value={pct(calibration.keptAvgConfidence)}
          hint={<span className="text-muted-foreground">mean confidence of merges that stuck</span>}
        />
      </div>
      <div className="mt-4 space-y-1.5">
        {calibration.bins.map((bin) => (
          <CalibrationRow key={bin.lowerPct} bin={bin} maxBinMerged={maxBinMerged} />
        ))}
      </div>
      {overconfidentBin ? (
        <p className="mt-3 text-token-2xs text-warning">
          Overconfidence: merges at {overconfidentBin.lowerPct}–{overconfidentBin.upperPct}%
          confidence were still reverted ({pct(overconfidentBin.keptRate)} kept).
        </p>
      ) : null}
    </section>
  );
}

function CalibrationRow({
  bin,
  maxBinMerged,
}: {
  bin: CalibrationConfidenceBin;
  maxBinMerged: number;
}) {
  const widthPct = maxBinMerged > 0 ? Math.round((bin.merged / maxBinMerged) * 100) : 0;
  const kept = bin.keptRate;
  return (
    <div className="flex items-center gap-2 text-token-2xs">
      <span className="w-14 shrink-0 font-mono text-muted-foreground">
        {bin.lowerPct}-{bin.upperPct}%
      </span>
      <div className="relative h-3 flex-1 overflow-hidden rounded-token border border-border">
        <div
          className={cn(
            "h-full",
            kept === null ? "bg-muted" : kept < 1 ? "bg-warning/50" : "bg-success/50",
          )}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span className="w-20 shrink-0 text-right font-mono text-foreground">
        {bin.merged > 0 ? `${pct(kept)} · n=${bin.merged}` : "—"}
      </span>
    </div>
  );
}
