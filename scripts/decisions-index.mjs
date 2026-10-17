#!/usr/bin/env node
/**
 * decisions-index.mjs — 从各决策文件生成 docs/adr/README.md。
 *
 * 每条决策在自己的文件里写着编号与标题，取代了更早的决策的会在 `取代` 那一行点名；退役且没有
 * 后继的编号落在 `retired.txt` 里，一行一个。索引是这些事实的表格，因此不会与它列的文件对不上。
 * 跑它写文件，`--check` 在提交的索引与文件不一致时失败。
 *
 * 用法：node scripts/decisions-index.mjs [--check]
 */
import fs from 'node:fs'
import path from 'node:path'

const DIR = path.resolve(import.meta.dirname, '..', 'docs', 'adr')
const FILE = path.join(DIR, 'README.md')
const RETIRED = path.join(DIR, 'retired.txt')

/** 表格上面的那段话归索引所有，不归任何一条决策。 */
const PREAMBLE = '# 架构决策\n\n本文件由 `npm run docs:index` 从各决策文件生成，勿手改。\n\n每条决策记一个方向，正文只有背景、决定、后果与重审条件。编号是稳定标识，代码注释按编号引用；被取代的编号作废、不复用（D14）。'

/**
 * 一条决策文件在索引里的信息。
 *
 * @param file - docs/adr 下的文件名。
 * @returns `{ file, number, title, replaced, retired }`。
 */
function readDecision(file) {
  const text = fs.readFileSync(path.join(DIR, file), 'utf8')
  const title = text.match(/^# (D(\d+)\. .+)$/m)
  if (title === null) throw new Error(`decisions-index: ${file} 没有 "# D<n>. <标题>" 这样的一级标题`)
  const replaced = text.match(/^- \*\*取代\*\*：(.+)$/m)
  const retired = []
  if (replaced !== null) for (const number of replaced[1].matchAll(/D(\d+)/g)) retired.push({ number: Number(number[1]), by: Number(title[2]) })
  return { file, number: Number(title[2]), title: title[1].replace(/^D\d+\.\s*/, ''), replaced: replaced === null ? '—' : replaced[1].trim(), retired }
}

/** 退役但没有后继的编号，一行一个 `D<n>`；`#` 开头是注释。 */
function retiredWithoutSuccessor() {
  if (!fs.existsSync(RETIRED)) return []
  const entries = []
  for (const line of fs.readFileSync(RETIRED, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const entry = trimmed.match(/^D(\d+)$/)
    if (entry === null) throw new Error(`decisions-index: retired.txt 里有一行不是单独的编号：${trimmed}`)
    entries.push({ number: Number(entry[1]), by: null })
  }
  return entries
}

const decisions = fs.readdirSync(DIR)
  .filter((name) => /^D\d+-.*\.md$/.test(name))
  .map(readDecision)
const numbers = new Set()
for (const decision of decisions) {
  if (numbers.has(decision.number)) throw new Error(`decisions-index: D${decision.number} 有两份文件`)
  numbers.add(decision.number)
}

const retired = [...decisions.flatMap((decision) => decision.retired), ...retiredWithoutSuccessor()].sort((a, b) => a.number - b.number)
const seen = new Set()
for (const entry of retired) {
  if (numbers.has(entry.number)) throw new Error(`decisions-index: D${entry.number} 既是活的又是退役的`)
  if (seen.has(entry.number)) throw new Error(`decisions-index: D${entry.number} 退役了两次`)
  seen.add(entry.number)
}

const lines = [PREAMBLE, '', '| 编号 | 决策 | 取代 |', '|---|---|---|']
for (const row of [...decisions].sort((a, b) => a.number - b.number)) {
  lines.push(`| [D${row.number}](${row.file}) | ${row.title} | ${row.replaced} |`)
}
lines.push('', '## 作废的编号', '')
lines.push(retired.length === 0
  ? '无。'
  : `${retired.map((entry) => entry.by === null ? `D${entry.number}（作废，无取代）` : `D${entry.number}（由 D${entry.by} 取代）`).join('、')}。`)
const index = `${lines.join('\n')}\n`

if (process.argv.includes('--check')) {
  const committed = fs.readFileSync(FILE, 'utf8')
  if (committed !== index) throw new Error('decisions-index: docs/adr/README.md 与各决策文件说的不一致；跑 `npm run docs:index`')
  console.log(`decisions-index: ${decisions.length} 条决策、${retired.length} 个作废编号，索引是最新的`)
} else {
  fs.writeFileSync(FILE, index)
  console.log(`decisions-index: 写了 ${decisions.length} 条决策与 ${retired.length} 个作废编号进 docs/adr/README.md`)
}
