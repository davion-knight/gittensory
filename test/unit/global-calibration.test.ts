import { describe, expect, it } from "vitest";
import { computeGlobalCalibration } from "../../src/review/global-calibration";
import { createTestEnv } from "../helpers/d1";

const NOW = Date.parse("2026-07-10T00:00:00Z");

async function seedMerged(
  env: Env,
  id: string,
  project: string,
  num: number,
  confidence: number | undefined,
  opts: {
    reverted?: boolean;
    createdAt?: string;
    decisionJson?: string | null;
  } = {},
) {
  const decisionJson =
    confidence === undefined
      ? (opts.decisionJson ?? null)
      : JSON.stringify({ verdict: "merge", confidence });
  await env.DB.prepare(
    `INSERT INTO review_targets (id, project, kind, repo, number, status, decision_json, created_at)
     VALUES (?, ?, 'pull_request', ?, ?, 'merged', ?, ?)`,
  )
    .bind(
      id,
      project,
      project,
      num,
      decisionJson,
      opts.createdAt ?? "2026-07-01T00:00:00Z",
    )
    .run();
  if (opts.reverted) {
    await env.DB.prepare(
      `INSERT INTO review_audit (id, project, target_id, event_type) VALUES (?, ?, ?, 'reversal_reverted')`,
    )
      .bind(`aud-${id}`, project, id)
      .run();
  }
}

describe("computeGlobalCalibration (#2192)", () => {
  it("aggregates merged-PR confidence vs reversals across projects into bins", async () => {
    const env = createTestEnv();
    await seedMerged(env, "a", "o/r1", 1, 0.95);
    await seedMerged(env, "b", "o/r2", 2, 0.97, { reverted: true });
    await seedMerged(env, "c", "o/r1", 3, 0.45);
    const r = await computeGlobalCalibration(env, { days: 90, nowMs: NOW });
    expect(r.mergedCount).toBe(3);
    expect(r.revertedCount).toBe(1);
    expect(r.revertedMaxConfidence).toBe(0.97);
    expect(r.recommendedFloor).toBe(0.99); // 0.97 + 0.02
    expect(r.bins[9]!.merged).toBe(2); // 0.95, 0.97 in the 90-100% bucket
    expect(r.bins[9]!.reverted).toBe(1);
    expect(r.bins[4]!.merged).toBe(1); // 0.45 in the 40-50% bucket
  });

  it("excludes merges outside the window and skips null / malformed / non-numeric confidence", async () => {
    const env = createTestEnv();
    await seedMerged(env, "old", "o/r", 1, 0.9, {
      createdAt: "2026-01-01T00:00:00Z",
    }); // before the 90d window
    await seedMerged(env, "nulljson", "o/r", 2, undefined, {
      decisionJson: null,
    });
    await seedMerged(env, "badjson", "o/r", 3, undefined, {
      decisionJson: "{not json",
    });
    await seedMerged(env, "nonnum", "o/r", 4, undefined, {
      decisionJson: JSON.stringify({ confidence: "high" }),
    });
    await seedMerged(env, "good", "o/r", 5, 0.8);
    const r = await computeGlobalCalibration(env, { days: 90, nowMs: NOW });
    expect(r.mergedCount).toBe(1); // only "good" carries a usable confidence within the window
    expect(r.bins[8]!.merged).toBe(1); // 0.8 → 80-90% bucket
  });

  it("clamps an invalid days window to the default (90d)", async () => {
    const env = createTestEnv();
    await seedMerged(env, "a", "o/r", 1, 0.8);
    const r = await computeGlobalCalibration(env, { days: 0, nowMs: NOW });
    expect(r.mergedCount).toBe(1);
  });

  it("returns an empty result when the driver yields no result set", async () => {
    const env = {
      DB: {
        prepare: () => ({
          bind: () => ({ all: async () => ({ results: undefined }) }),
        }),
      },
    } as unknown as Env;
    const r = await computeGlobalCalibration(env, { days: 90, nowMs: NOW });
    expect(r.mergedCount).toBe(0);
    expect(r.hasSignal).toBe(false);
  });

  it("fails safe to an empty result on a read error", async () => {
    const env = {
      DB: {
        prepare: () => {
          throw new Error("boom");
        },
      },
    } as unknown as Env;
    const r = await computeGlobalCalibration(env, { days: 90, nowMs: NOW });
    expect(r.mergedCount).toBe(0);
  });
});
