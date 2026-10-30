import type { PlanOutput, PlannedCase, ReviewOutput } from './schemas.ts';

export type CaseDecision = PlannedCase & { verdict: 'keep' | 'drop'; verdictReason: string; reviewed: boolean };

export function numberCases(plan: PlanOutput, firstNumber = 1): PlannedCase[] {
  let nextNumber = firstNumber;
  return plan.files.flatMap((file) =>
    file.cases.map((plannedCase) => ({
      ...plannedCase,
      id: `c${nextNumber++}`,
      sourceFile: file.sourceFile,
      testFile: file.testFile,
    })),
  );
}

export function applyReview(cases: PlannedCase[], review: ReviewOutput): CaseDecision[] {
  const verdicts = new Map(review.verdicts.map((verdict) => [verdict.caseId, verdict]));
  return cases.map((plannedCase) => {
    const verdict = verdicts.get(plannedCase.id);
    return {
      ...plannedCase,
      verdict: verdict?.verdict ?? 'keep',
      verdictReason: verdict?.reason ?? 'The reviewer gave no verdict, so the case is kept.',
      reviewed: verdict !== undefined,
    };
  });
}

type PlanCheck = {
  sourceFiles: Set<string>;
  isWritable: (repositoryPath: string) => boolean;
};

export function partitionPlannedCases(cases: PlannedCase[], { sourceFiles, isWritable }: PlanCheck) {
  const accepted: PlannedCase[] = [];
  const rejected: { plannedCase: PlannedCase; reason: string }[] = [];
  for (const plannedCase of cases) {
    if (!sourceFiles.has(plannedCase.sourceFile)) {
      rejected.push({ plannedCase, reason: `${plannedCase.sourceFile} isn't part of this batch` });
    } else if (!isWritable(plannedCase.testFile)) {
      rejected.push({ plannedCase, reason: `${plannedCase.testFile} isn't a writable test path` });
    } else {
      accepted.push(plannedCase);
    }
  }
  return { accepted, rejected };
}
