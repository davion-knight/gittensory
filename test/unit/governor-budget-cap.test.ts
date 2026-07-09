import { describe, expect, it } from "vitest";
import { evaluateGovernorCaps, type GovernorCapLimits, type GovernorCapUsage } from "../../packages/gittensory-engine/src/governor/budget-cap";
import { GOVERNOR_LEDGER_EVENT_TYPES } from "../../packages/gittensory-engine/src/governor-ledger";

const LIMITS: GovernorCapLimits = { maxBudget: 100, maxTurns: 10, maxElapsedMs: 60_000 };
const clone = (over: Partial<GovernorCapUsage>): GovernorCapUsage => ({ budgetSpent: 0, turnsTaken: 0, elapsedMs: 0, ...over });

describe("evaluateGovernorCaps (#4288 governor cap calculator)", () => {
  it("allows a run under every cap and reports remaining headroom", () => {
    const v = evaluateGovernorCaps(clone({ budgetSpent: 40, turnsTaken: 3, elapsedMs: 20_000 }), LIMITS);
    expect(v.decision).toBe("allowed");
    expect(v.exceeded).toEqual([]);
    expect(v.remaining).toEqual({ budget: 60, turns: 7, elapsedMs: 40_000 });
    // verdict stays inside the immutable governor vocabulary
    expect(GOVERNOR_LEDGER_EVENT_TYPES).toContain(v.decision);
  });

  it("denies at the budget cap (at-cap is fail-closed) and zeroes that dimension's remaining", () => {
    const v = evaluateGovernorCaps(clone({ budgetSpent: 100 }), LIMITS);
    expect(v.decision).toBe("denied");
    expect(v.exceeded).toEqual(["budget"]);
    expect(v.remaining.budget).toBe(0);
  });

  it("denies over the turns cap and never returns negative remaining", () => {
    const v = evaluateGovernorCaps(clone({ turnsTaken: 13 }), LIMITS);
    expect(v.decision).toBe("denied");
    expect(v.exceeded).toEqual(["turns"]);
    expect(v.remaining.turns).toBe(0);
  });

  it("denies at/over the termination (elapsed-time) cap", () => {
    const v = evaluateGovernorCaps(clone({ elapsedMs: 60_000 }), LIMITS);
    expect(v.decision).toBe("denied");
    expect(v.exceeded).toEqual(["termination"]);
    expect(v.remaining.elapsedMs).toBe(0);
  });

  it("reports EVERY exceeded dimension in a combined-verdict, in fixed order", () => {
    const v = evaluateGovernorCaps({ budgetSpent: 200, turnsTaken: 99, elapsedMs: 120_000 }, LIMITS);
    expect(v.decision).toBe("denied");
    expect(v.exceeded).toEqual(["budget", "turns", "termination"]);
    expect(v.remaining).toEqual({ budget: 0, turns: 0, elapsedMs: 0 });
  });

  it("normalizes non-finite / negative usage and limits so the verdict is never NaN or negative", () => {
    const v = evaluateGovernorCaps(
      { budgetSpent: Number.NaN, turnsTaken: -5, elapsedMs: Number.POSITIVE_INFINITY },
      { maxBudget: 50, maxTurns: Number.NaN, maxElapsedMs: -1 },
    );
    // NaN budget → 0 spent vs 50 cap → 0<50 → under (not exceeded); -5 turns → 0 vs NaN cap → 0, 0>=0 → denied on
    // turns; Infinity elapsed → 0 (non-finite floored to 0) vs -1 cap → 0, 0>=0 → denied on termination.
    expect(v.exceeded).toEqual(["turns", "termination"]);
    expect(v.decision).toBe("denied");
    expect(v.remaining.budget).toBe(50);
    for (const value of [v.remaining.budget, v.remaining.turns, v.remaining.elapsedMs]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("is deterministic: same inputs yield identical output", () => {
    const usage = clone({ budgetSpent: 50, turnsTaken: 5, elapsedMs: 30_000 });
    expect(evaluateGovernorCaps(usage, LIMITS)).toEqual(evaluateGovernorCaps(usage, LIMITS));
  });
});
