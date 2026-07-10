import { describe, expect, it } from "vitest";
import { computeCalibrationBins } from "../../packages/gittensory-engine/src/index";
import type { CalibrationSample } from "../../packages/gittensory-engine/src/index";

const s = (confidence: number, reverted = false): CalibrationSample => ({
  confidence,
  reverted,
});

describe("computeCalibrationBins (#2192)", () => {
  it("returns ten empty buckets and no signal for an empty series", () => {
    const r = computeCalibrationBins([]);
    expect(r.bins).toHaveLength(10);
    expect(r.bins.map((b) => [b.lowerPct, b.upperPct])).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
      [30, 40],
      [40, 50],
      [50, 60],
      [60, 70],
      [70, 80],
      [80, 90],
      [90, 100],
    ]);
    expect(
      r.bins.every(
        (b) => b.merged === 0 && b.reverted === 0 && b.keptRate === null,
      ),
    ).toBe(true);
    expect(r).toMatchObject({
      mergedCount: 0,
      revertedCount: 0,
      keptAvgConfidence: null,
      revertedMaxConfidence: null,
      recommendedFloor: null,
      hasSignal: false,
    });
  });

  it("buckets by confidence and computes a per-bucket kept-rate", () => {
    // bucket 90-100%: 3 merged, 1 reverted → keptRate 0.667; bucket 40-50%: 1 merged, 0 reverted → 1
    const r = computeCalibrationBins([s(0.95), s(0.97, true), s(0.9), s(0.45)]);
    const top = r.bins[9]!;
    expect([top.merged, top.reverted, top.keptRate]).toEqual([3, 1, 0.667]);
    const mid = r.bins[4]!;
    expect([mid.merged, mid.reverted, mid.keptRate]).toEqual([1, 0, 1]);
    expect(r.mergedCount).toBe(4);
    expect(r.revertedCount).toBe(1);
  });

  it("puts a boundary confidence of exactly 1.0 in the top bucket (clamped, not overflowed)", () => {
    const r = computeCalibrationBins([s(1)]);
    expect(r.bins[9]!.merged).toBe(1);
  });

  it("summarizes kept vs reverted confidence and recommends a floor above the worst reverted merge", () => {
    const r = computeCalibrationBins([
      s(0.8),
      s(0.6),
      s(0.92, true),
      s(0.5, true),
    ]);
    expect(r.keptAvgConfidence).toBe(0.7); // (0.8 + 0.6) / 2
    expect(r.revertedMaxConfidence).toBe(0.92);
    expect(r.recommendedFloor).toBe(0.94); // 0.92 + 0.02
  });

  it("recommends no floor when nothing was reverted", () => {
    const r = computeCalibrationBins([s(0.8), s(0.9)]);
    expect(r.revertedMaxConfidence).toBeNull();
    expect(r.recommendedFloor).toBeNull();
    expect(r.keptAvgConfidence).toBe(0.85);
  });

  it("caps the recommended floor at 0.99 for a near-certain reverted merge", () => {
    const r = computeCalibrationBins([s(0.995, true)]);
    expect(r.recommendedFloor).toBe(0.99);
    expect(r.keptAvgConfidence).toBeNull(); // no kept merges
  });

  it("flags signal only once the sample floor is reached", () => {
    expect(
      computeCalibrationBins(Array.from({ length: 9 }, () => s(0.8))).hasSignal,
    ).toBe(false);
    expect(
      computeCalibrationBins(Array.from({ length: 10 }, () => s(0.8)))
        .hasSignal,
    ).toBe(true);
  });
});
