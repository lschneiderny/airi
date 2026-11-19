import type { CriterionReport, ReportConstant, ReportRequirement } from './report'

import { criterionReport } from './report'

/**
 * A requirement whose case may not occur in a run. NOT-EXERCISED never passes: a rule that needs a case (an act played,
 * a turn made, a rest state reached) is not met by a run without it, so the report's verdict fails. REPORT is a line kept
 * printed but out of the verdict (`reportOnly`).
 */
export interface CaseRequirement extends ReportRequirement {
  readonly status: 'PASS' | 'FAIL' | 'NOT-EXERCISED' | 'REPORT'
}

export interface CaseReport<Detail> extends CriterionReport<Detail> {
  readonly requirements: readonly CaseRequirement[]
}

export function judged(id: string, rule: string, value: string, pass: boolean): CaseRequirement {
  return { id, rule, value, pass, status: pass ? 'PASS' : 'FAIL' }
}

export function notExercised(id: string, rule: string, reason: string): CaseRequirement {
  return { id, rule, value: reason, pass: false, status: 'NOT-EXERCISED' }
}

export function caseReport<Detail>(kind: string, version: number, inputs: readonly string[], constants: readonly ReportConstant[], requirements: readonly CaseRequirement[], detail: Detail): CaseReport<Detail> {
  return { ...criterionReport(kind, version, inputs, constants, requirements, detail), requirements }
}

/** Header, constants with their sources and every requirement with its status; `body` adds the report's own lines. */
export function formatCaseReport(report: CaseReport<unknown>, body: readonly string[]): string {
  return `${[
    `${report.kind} version ${report.version}: ${report.verdict}`,
    `inputs: ${report.inputs.join(', ')}`,
    'constants:',
    ...report.constants.map(c => `  ${c.name} = ${c.value} ${c.unit} (${c.source})`),
    'requirements:',
    ...report.requirements.map(r => `  ${r.status} ${r.id}: ${r.value}; rule: ${r.rule}`),
    '',
    ...body,
  ].join('\n')}\n`
}
