import type { Run } from "./types.js";
import { RunStatus } from "./types.js";
import { PolicyEngine, runHasMutations, type Policy } from "./policy.js";

// ─── Score types ─────────────────────────────────────────────────────────────

export enum MergeRecommendation {
  Merge = "merge",
  Block = "block",
  Review = "review",
}

export interface ScoreDimension {
  readonly score: number; // 0-1
  readonly rationale: string;
}

export interface ScoreCard {
  readonly correctness: ScoreDimension;
  readonly regressionRisk: ScoreDimension;
  readonly scopeRisk: ScoreDimension;
  readonly policyCompliance: ScoreDimension;
  readonly unknowns: ScoreDimension;
  readonly mergeRecommendation: MergeRecommendation;
}

// ─── Scoring logic ───────────────────────────────────────────────────────────

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function scoreCorrectness(run: Run): ScoreDimension {
  const allTests = run.evaluations.flatMap((e) => e.testResults);
  if (allTests.length === 0) {
    if (!runHasMutations(run)) {
      return { score: 1, rationale: "Read-only session — no tests required" };
    }
    return { score: 0, rationale: "No test results available" };
  }
  const passing = allTests.filter((t) => t.passed).length;
  const total = allTests.length;
  const score = clamp(passing / total);
  return {
    score,
    rationale: `${passing}/${total} tests passing`,
  };
}

function scoreRegressionRisk(run: Run): ScoreDimension {
  if (!runHasMutations(run)) {
    return { score: 1, rationale: "Read-only session — no regression risk" };
  }

  const flakeRate = run.metrics.flakeRate;
  const allTests = run.evaluations.flatMap((e) => e.testResults);
  const failingTests = allTests.filter((t) => !t.passed);

  if (failingTests.length > 0) {
    return {
      score: clamp(1 - failingTests.length / Math.max(allTests.length, 1)),
      rationale: `${failingTests.length} failing test(s) indicate regression risk`,
    };
  }

  const score = clamp(1 - flakeRate);
  return {
    score,
    rationale:
      flakeRate > 0
        ? `Flake rate of ${(flakeRate * 100).toFixed(1)}% introduces uncertainty`
        : "No flaky tests detected",
  };
}

function scoreScopeRisk(run: Run): ScoreDimension {
  const editedFiles = new Set(
    run.actions.flatMap((a) => a.fileEdits.map((e) => e.path))
  );
  const fileCount = editedFiles.size;

  // Heuristic: more files = higher scope risk
  if (fileCount <= 3) {
    return { score: 1, rationale: `Small scope: ${fileCount} file(s) changed` };
  }
  if (fileCount <= 10) {
    return {
      score: clamp(1 - (fileCount - 3) / 20),
      rationale: `Moderate scope: ${fileCount} files changed`,
    };
  }
  return {
    score: clamp(0.3 - (fileCount - 10) / 100),
    rationale: `Large scope: ${fileCount} files changed`,
  };
}

function scorePolicyCompliance(run: Run, policies: ReadonlyArray<Policy>): ScoreDimension {
  if (policies.length === 0) {
    return { score: 1, rationale: "No policies configured" };
  }
  const engine = new PolicyEngine();
  const results = engine.evaluate(run, policies);
  const passing = results.filter((r) => r.passed).length;
  const total = results.length;
  const score = clamp(passing / total);
  return {
    score,
    rationale:
      passing === total
        ? `All ${total} policies passing`
        : `${total - passing} of ${total} policies failing`,
  };
}

function scoreUnknowns(run: Run): ScoreDimension {
  if (!runHasMutations(run)) {
    return { score: 1, rationale: "Read-only session — no evidence required" };
  }

  const hasTests = run.evaluations.some((e) => e.testResults.length > 0);
  const hasArtifacts = run.artifacts.length > 0;
  const hasEvaluations = run.evaluations.length > 0;

  let unknowns = 0;
  const reasons: string[] = [];

  if (!hasTests) {
    unknowns++;
    reasons.push("no tests");
  }
  if (!hasArtifacts) {
    unknowns++;
    reasons.push("no artifacts");
  }
  if (!hasEvaluations) {
    unknowns++;
    reasons.push("no evaluations");
  }

  if (unknowns === 0) {
    return { score: 1, rationale: "All evidence categories present" };
  }

  const score = clamp(1 - unknowns / 3);
  return {
    score,
    rationale: `Missing evidence: ${reasons.join(", ")}`,
  };
}

function deriveRecommendation(dimensions: {
  correctness: ScoreDimension;
  regressionRisk: ScoreDimension;
  scopeRisk: ScoreDimension;
  policyCompliance: ScoreDimension;
  unknowns: ScoreDimension;
}): MergeRecommendation {
  // Block if any critical dimension is very low
  if (dimensions.correctness.score < 0.5) return MergeRecommendation.Block;
  if (dimensions.policyCompliance.score < 0.5) return MergeRecommendation.Block;
  if (dimensions.regressionRisk.score < 0.3) return MergeRecommendation.Block;

  // Review if moderate concerns
  if (dimensions.unknowns.score < 0.5) return MergeRecommendation.Review;
  if (dimensions.scopeRisk.score < 0.5) return MergeRecommendation.Review;
  if (dimensions.correctness.score < 0.8) return MergeRecommendation.Review;
  if (dimensions.regressionRisk.score < 0.7) return MergeRecommendation.Review;

  return MergeRecommendation.Merge;
}

export function computeScore(
  run: Run,
  policies: ReadonlyArray<Policy> = []
): ScoreCard {
  // A non-completed run cannot be merge-worthy
  if (run.status !== RunStatus.Completed) {
    const blocked: ScoreDimension = {
      score: 0,
      rationale: `Run status is "${run.status}", not completed`,
    };
    return {
      correctness: blocked,
      regressionRisk: blocked,
      scopeRisk: blocked,
      policyCompliance: blocked,
      unknowns: blocked,
      mergeRecommendation: MergeRecommendation.Block,
    };
  }

  const correctness = scoreCorrectness(run);
  const regressionRisk = scoreRegressionRisk(run);
  const scopeRisk = scoreScopeRisk(run);
  const policyCompliance = scorePolicyCompliance(run, policies);
  const unknowns = scoreUnknowns(run);

  const mergeRecommendation = deriveRecommendation({
    correctness,
    regressionRisk,
    scopeRisk,
    policyCompliance,
    unknowns,
  });

  return {
    correctness,
    regressionRisk,
    scopeRisk,
    policyCompliance,
    unknowns,
    mergeRecommendation,
  };
}
