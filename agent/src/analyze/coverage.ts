import { z } from 'zod';
import { containerWorkspacePath } from '../sandbox/test-results.ts';

const positionSchema = z.object({ line: z.number().nullish() });
const rangeSchema = z.object({ start: positionSchema });

const fileCoverageSchema = z.object({
  path: z.string(),
  statementMap: z.record(z.string(), rangeSchema),
  s: z.record(z.string(), z.number()),
  branchMap: z.record(z.string(), z.object({ type: z.string(), line: z.number().nullish(), loc: rangeSchema })),
  b: z.record(z.string(), z.array(z.number())),
});

export const coverageReportSchema = z.record(z.string(), fileCoverageSchema);

export type UncoveredBranch = {
  line: number;
  type: string;
  takenOutcomes: number;
  totalOutcomes: number;
};

export type FileCoverage = {
  statements: { covered: number; total: number };
  branches: { covered: number; total: number };
  uncoveredLines: number[];
  uncoveredBranches: UncoveredBranch[];
};

export type CoverageByFile = Map<string, FileCoverage>;

function summariseFile(file: z.output<typeof fileCoverageSchema>): FileCoverage {
  const uncoveredLines = new Set<number>();
  let coveredStatements = 0;
  for (const [statementId, count] of Object.entries(file.s)) {
    if (count > 0) coveredStatements += 1;
    else {
      const line = file.statementMap[statementId]?.start.line;
      if (line) uncoveredLines.add(line);
    }
  }
  let coveredOutcomes = 0;
  let totalOutcomes = 0;
  const uncoveredBranches: UncoveredBranch[] = [];
  for (const [branchId, counts] of Object.entries(file.b)) {
    const taken = counts.filter((count) => count > 0).length;
    coveredOutcomes += taken;
    totalOutcomes += counts.length;
    const branch = file.branchMap[branchId];
    const line = branch?.line ?? branch?.loc.start.line;
    if (taken < counts.length && line) {
      uncoveredBranches.push({ line, type: branch.type, takenOutcomes: taken, totalOutcomes: counts.length });
    }
  }
  return {
    statements: { covered: coveredStatements, total: Object.keys(file.s).length },
    branches: { covered: coveredOutcomes, total: totalOutcomes },
    uncoveredLines: [...uncoveredLines].sort((first, second) => first - second),
    uncoveredBranches: uncoveredBranches.sort((first, second) => first.line - second.line),
  };
}

export function isFullyCovered(coverage: FileCoverage) {
  return coverage.statements.covered === coverage.statements.total && coverage.branches.covered === coverage.branches.total;
}

export function summariseCoverage(report: z.output<typeof coverageReportSchema>, workspaceRoot: string): CoverageByFile {
  const coverageByFile: CoverageByFile = new Map();
  for (const file of Object.values(report)) {
    if (!file.path.startsWith(containerWorkspacePath)) continue;
    const repositoryPath = `${workspaceRoot}/${file.path.slice(containerWorkspacePath.length)}`;
    coverageByFile.set(repositoryPath, summariseFile(file));
  }
  return coverageByFile;
}
