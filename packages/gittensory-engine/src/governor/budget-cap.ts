// Governor budget / turn / termination cap calculator (pure) — #4288, Wave 2 tracker #2353 milestone 13.
//
// A SIBLING to governor/rate-limit.ts, not built on top of it: rate-limit.ts computes a rolling-WINDOW request
// rate that resets, whereas these caps are cumulative, monotonic counters across a whole run — total budget spent,
// total turns taken, and elapsed session time vs. a termination ceiling. Same discipline as its sibling: pure, no
// IO, no internally-read clock (elapsed time and usage counts are caller-supplied, exactly like rate-limit.ts's
// injected nowMs), and every numeric input normalized so a non-finite or negative value can never produce a NaN or
// a negative remaining value. This module computes a verdict ONLY — it does NOT store state, schedule anything, or
// gate a write action; composing this with rate-limit + the non-convergence detector into the real fail-closed
// allow/deny chokepoint before every miner write is separate, maintainer-owned work (#2340, milestone 13).

import type { GovernorLedgerEventType } from "../governor-ledger.js";

/** The three independent cumulative ceilings for a run. A non-positive/omitted ceiling means the dimension is
 *  already at its cap (fail-closed): a 0 budget/turn/time run is denied from the start rather than unbounded. */
export type GovernorCapLimits = {
  /** Maximum cumulative cost/budget units permitted for the whole run (e.g. estimated neurons). */
  maxBudget: number;
  /** Maximum cumulative turns/iterations permitted for the whole run. */
  maxTurns: number;
  /** Maximum elapsed session time, in milliseconds, before the run must terminate. */
  maxElapsedMs: number;
};

/** A snapshot of cumulative usage so far. Every value is caller-supplied — this module never reads a clock or a
 *  usage counter itself, so it stays fully deterministic and unit-testable (mirrors rate-limit.ts's injected clock). */
export type GovernorCapUsage = {
  /** Cumulative cost/budget units spent so far. */
  budgetSpent: number;
  /** Cumulative turns/iterations taken so far. */
  turnsTaken: number;
  /** Elapsed session time so far, in milliseconds. */
  elapsedMs: number;
};

/** The cap dimensions, so a caller can render exactly which ceiling(s) stopped a run. */
export type GovernorCapDimension = "budget" | "turns" | "termination";

/** The verdict. `decision` reuses the immutable governor vocabulary (`GOVERNOR_LEDGER_EVENT_TYPES`) rather than a
 *  new ad hoc set: `denied` when ANY dimension is at or over its cap, else `allowed`. */
export type GovernorCapVerdict = {
  decision: Extract<GovernorLedgerEventType, "allowed" | "denied">;
  /** Every dimension currently at or over its cap, in a fixed order (empty when allowed). */
  exceeded: GovernorCapDimension[];
  /** Headroom left per dimension before its cap — never negative. */
  remaining: { budget: number; turns: number; elapsedMs: number };
};

/** Normalize any numeric input to a non-negative finite number (a non-finite or negative value becomes 0), so no
 *  usage/limit can make a verdict NaN or a remaining value negative. Mirrors rate-limit.ts's `finiteNonNegativeInt`
 *  but keeps fractional precision — a budget in cost units is legitimately non-integer. */
function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Evaluate the three cumulative run caps and combine them into a single verdict (#4288). Pure: it reads the usage
 * snapshot + limits and returns a verdict without mutating anything. Each dimension is evaluated INDEPENDENTLY —
 * at-or-over its own ceiling denies — and any single exceeded dimension makes the overall decision `denied`
 * (fail-closed). Every numeric input is normalized first, so a non-finite, negative, or fractional usage/limit can
 * never produce a NaN verdict or a negative remaining value.
 */
export function evaluateGovernorCaps(usage: GovernorCapUsage, limits: GovernorCapLimits): GovernorCapVerdict {
  const maxBudget = finiteNonNegative(limits.maxBudget);
  const maxTurns = finiteNonNegative(limits.maxTurns);
  const maxElapsedMs = finiteNonNegative(limits.maxElapsedMs);
  const budgetSpent = finiteNonNegative(usage.budgetSpent);
  const turnsTaken = finiteNonNegative(usage.turnsTaken);
  const elapsedMs = finiteNonNegative(usage.elapsedMs);

  const exceeded: GovernorCapDimension[] = [];
  if (budgetSpent >= maxBudget) exceeded.push("budget");
  if (turnsTaken >= maxTurns) exceeded.push("turns");
  if (elapsedMs >= maxElapsedMs) exceeded.push("termination");

  return {
    decision: exceeded.length > 0 ? "denied" : "allowed",
    exceeded,
    remaining: {
      budget: Math.max(0, maxBudget - budgetSpent),
      turns: Math.max(0, maxTurns - turnsTaken),
      elapsedMs: Math.max(0, maxElapsedMs - elapsedMs),
    },
  };
}
