import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CalibrationCard } from "@/components/site/app-panels/calibration-card";
import {
  summarizeCalibration,
  type CalibrationBinsResult,
} from "@/components/site/app-panels/calibration-card-model";

function bin(
  lowerPct: number,
  merged: number,
  reverted: number,
): CalibrationBinsResult["bins"][number] {
  return {
    lowerPct,
    upperPct: lowerPct + 10,
    merged,
    reverted,
    keptRate: merged ? (merged - reverted) / merged : null,
  };
}

function result(overrides: Partial<CalibrationBinsResult> = {}): CalibrationBinsResult {
  const bins = Array.from({ length: 10 }, (_, i) => bin(i * 10, 0, 0));
  return {
    bins,
    mergedCount: 0,
    revertedCount: 0,
    keptAvgConfidence: null,
    revertedMaxConfidence: null,
    recommendedFloor: null,
    hasSignal: false,
    ...overrides,
  };
}

describe("summarizeCalibration", () => {
  it("finds the bar scale and the highest-confidence overconfident bucket", () => {
    const bins = result().bins.slice();
    bins[9] = bin(90, 5, 2); // high confidence, some reverted → overconfident
    bins[8] = bin(80, 3, 0); // clean
    const summary = summarizeCalibration(result({ bins }));
    expect(summary.maxBinMerged).toBe(5);
    expect(summary.overconfidentBin?.lowerPct).toBe(90);
  });

  it("reports no overconfident bucket when every merge stuck", () => {
    const bins = result().bins.slice();
    bins[9] = bin(90, 4, 0);
    const summary = summarizeCalibration(result({ bins }));
    expect(summary.overconfidentBin).toBeNull();
    expect(summary.maxBinMerged).toBe(4);
  });
});

describe("CalibrationCard", () => {
  it("renders nothing until at least one merge has a confidence reading", () => {
    const { container } = render(<CalibrationCard calibration={result()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the floor, kept-confidence, and an overconfidence note when present", () => {
    const bins = result().bins.slice();
    bins[9] = bin(90, 6, 1);
    render(
      <CalibrationCard
        calibration={result({
          bins,
          mergedCount: 6,
          revertedCount: 1,
          keptAvgConfidence: 0.9,
          revertedMaxConfidence: 0.97,
          recommendedFloor: 0.99,
          hasSignal: false,
        })}
      />,
    );
    expect(screen.getByText("Confidence calibration")).toBeTruthy();
    expect(screen.getByText("99%")).toBeTruthy(); // recommended floor
    expect(screen.getByText("below sample floor")).toBeTruthy();
    expect(screen.getByText(/Overconfidence:/)).toBeTruthy();
  });
});
