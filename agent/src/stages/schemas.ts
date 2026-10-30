import { z } from 'zod';

const plannedCaseSchema = z.object({
  name: z.string().min(1),
  behaviour: z.string().min(1),
  catches: z.string().min(1),
  reason: z.string().min(1),
  overlap: z.string().min(1),
  updatesExistingTest: z.boolean(),
});

export const planOutputSchema = z.object({
  files: z.array(
    z.object({
      sourceFile: z.string().min(1),
      testFile: z.string().min(1),
      cases: z.array(plannedCaseSchema),
    }),
  ),
  skipped: z.array(z.object({ sourceFile: z.string().min(1), reason: z.string().min(1) })),
});

export const reviewOutputSchema = z.object({
  verdicts: z.array(z.object({ caseId: z.string().min(1), verdict: z.enum(['keep', 'drop']), reason: z.string().min(1) })),
  missing: z.array(z.object({ sourceFile: z.string().min(1), behaviour: z.string().min(1), reason: z.string().min(1) })),
});

export const writeOutputSchema = z.object({
  written: z.array(z.object({ testFile: z.string().min(1), caseIds: z.array(z.string()) })),
});

export const fixOutputSchema = z.object({
  changed: z.array(z.string()),
  notes: z.string(),
});

export type PlanOutput = z.output<typeof planOutputSchema>;
export type ReviewOutput = z.output<typeof reviewOutputSchema>;
export type PlannedCase = z.output<typeof plannedCaseSchema> & { id: string; sourceFile: string; testFile: string };
