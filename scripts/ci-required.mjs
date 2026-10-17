#!/usr/bin/env node
/**
 * ci-required.mjs — 分支规则点名的唯一一道检查。
 *
 * 分支规则要是逐一点名每个 job，加一个或改一次名就得改规则，而规则没点到的 job 合并时会漏过去。
 * 这一份读工作流传进来的 `needs`（也就是 `toJson(needs)` 那份，一行一个 job 带它的 `result`），
 * 只要有一个既不是 `success` 也不是 `skipped` 就失败，于是规则只点这一道，job 可以自由增删改名。
 *
 * 用法：node scripts/ci-required.mjs '<toJson(needs)>'
 */
const needs = JSON.parse(process.argv[2] ?? '{}')
const entries = Object.entries(needs)
if (entries.length === 0) {
  console.error('ci-required: 没有收到任何 job；工作流要把 `needs` 传进来')
  process.exit(2)
}
for (const [job, state] of entries) console.log(`ci-required: ${job} — ${state.result}`)
// 被工作流自己的 `if` 略过的 job 报的是 `skipped`，那是一次没碰代码的推送该有的答案；取消与失败不是。
const failed = entries.filter(([, state]) => state.result !== 'success' && state.result !== 'skipped')
if (failed.length > 0) {
  console.error(`ci-required: ${failed.map(([job]) => job).join('、')} 没有通过`)
  process.exit(1)
}
console.log(`ci-required: ${entries.length} 个 job 全部通过`)
