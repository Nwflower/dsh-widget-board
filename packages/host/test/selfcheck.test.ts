/**
 * `widget_define` 的自检登记处（D9、D13）：任务的交接、第一份报告算数、无人接手时给出 unverified。
 */
import { describe, expect, it } from 'vitest'
import type { InspectionReport, SelfCheckBoxResult, SelfCheckJob } from '@dsh-widget-board/contracts'
import { inspectionProblems, isSelfCheckBoxResults, selfCheckBoxes } from '@dsh-widget-board/contracts'
import { createSelfChecks, verdictOf } from '../src/selfcheck'

const JOB: SelfCheckJob = { widget: 'demo', hash: 'a'.repeat(64), props: {}, data: null, boxes: [{ cols: 1, h: 22 }] }

/** 一份干净的报告。 */
function report(extra: Partial<InspectionReport> = {}): InspectionReport {
  return { w: 320, h: 352, overflowX: false, clippedText: [], clippedControls: [], blank: false, errors: [], csp: [], ...extra }
}

/** 一个盒子的结果，问题按共用的判定读出来。 */
function boxResult(extra: Partial<InspectionReport> = {}): SelfCheckBoxResult {
  const measured = report(extra)
  return { box: { cols: 1, h: 22 }, report: measured, problems: inspectionProblems(measured) }
}

describe('自检登记处', () => {
  it('登记之前取任务是 pending，登记之后取到任务，交回报告之后是 gone', async () => {
    const checks = createSelfChecks(1000)
    expect(checks.take('c1')).toBe('pending')
    const running = checks.run('c1', JOB, new AbortController().signal)
    expect(checks.take('c1')).toEqual(JOB)
    expect(checks.settle('c1', [boxResult()])).toBe(true)
    await expect(running).resolves.toMatchObject({ status: 'passed', problems: [] })
    expect(checks.take('c1')).toBe('gone')
  })

  it('只有第一份报告算数', async () => {
    const checks = createSelfChecks(1000)
    const running = checks.run('c1', JOB, new AbortController().signal)
    expect(checks.settle('c1', [boxResult({ overflowX: true })])).toBe(true)
    expect(checks.settle('c1', [boxResult()])).toBe(false)
    const result = await running
    expect(result.status).toBe('failed')
    expect(result.problems[0]).toMatch(/横向超出/)
  })

  it('没有页面交回报告时到点给出 unverified 并写明原因', async () => {
    const checks = createSelfChecks(10)
    const result = await checks.run('c1', JOB, new AbortController().signal)
    expect(result).toMatchObject({ status: 'unverified', boxes: [] })
    expect(result.reason).toMatch(/没有人看过/)
    expect(checks.take('c1')).toBe('gone')
  })

  it('调用被取消时立刻结束', async () => {
    const checks = createSelfChecks(10_000)
    const controller = new AbortController()
    const running = checks.run('c1', JOB, controller.signal)
    controller.abort()
    await expect(running).resolves.toMatchObject({ status: 'unverified', reason: expect.stringMatching(/取消/) })
  })

  it('没有登记的调用不接报告', () => {
    expect(createSelfChecks().settle('nobody', [boxResult()])).toBe(false)
  })
})

describe('自检的判定', () => {
  it('没有应答的盒子与报告里的问题都算失败，问题去重', () => {
    const verdict = verdictOf([
      boxResult({ errors: ['boom'] }),
      boxResult({ errors: ['boom'] }),
      { box: { cols: 2, h: 14 }, failure: '组件没有应答', problems: [] },
    ])
    expect(verdict.status).toBe('failed')
    expect(verdict.problems).toEqual(['脚本错误：boom', '组件没有应答'])
  })

  it('截断的文字、控件、空白与 CSP 各自读成一条问题', () => {
    const problems = inspectionProblems(report({ clippedText: ['p.last'], clippedControls: ['button'], blank: true, csp: ['https://x.test'] }))
    expect(problems).toHaveLength(4)
    expect(problems.join('\n')).toMatch(/文字被截掉[\s\S]*控件被截掉[\s\S]*空白[\s\S]*CSP/)
  })

  it('盒子按组件的下限挑选', () => {
    expect(selfCheckBoxes(undefined)).toHaveLength(4)
    expect(selfCheckBoxes({ w: 2, h: 14 })).toEqual([{ cols: 2, h: 14 }, { cols: 4, h: 30 }])
  })

  it('报告的形状不对时整份拒绝', () => {
    expect(isSelfCheckBoxResults([boxResult()])).toBe(true)
    expect(isSelfCheckBoxResults([{ box: { cols: 1, h: 22 }, problems: [1] }])).toBe(false)
    expect(isSelfCheckBoxResults([{ box: { cols: 1, h: 22 }, problems: [], report: { w: 1 } }])).toBe(false)
    expect(isSelfCheckBoxResults('nope')).toBe(false)
  })
})
