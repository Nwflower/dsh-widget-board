#!/usr/bin/env node
/**
 * agents-commands.mjs — 从 `package.json` 生成 AGENTS.md 的命令表。
 *
 * 手打的命令表在脚本增删或改用途的那一刻就过期，而 AGENTS.md 是 agent 先读的那份文件。每个
 * 脚本自己的头部已经写着它做什么，所以这里按 `package.json` 里的声明次序读 `scripts`，取每条
 * 命令指向的脚本文件头部的说法，写进 AGENTS.md 两个标记之间。文件自己说不出的用途（`:check`
 * 的孪生命令、单元层自己的运行器）写在下面的 OVERRIDES 里。
 *
 * 用法：node scripts/agents-commands.mjs [--print | --check]
 *       --print 什么也不写，把表打出来；--check 在提交的表与脚本不一致时失败。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const AGENTS = path.join(ROOT, 'AGENTS.md')
const START = '<!-- commands:start — 由 npm run agents 写出，不要手改 -->'
const END = '<!-- commands:end -->'

/** 脚本文件自己说不出的用途：孪生命令读同一个文件，`test` 是运行器自己的命令。 */
const OVERRIDES = {
  test: '单元层单独跑一遍，也就是云端任务跑它的方式：Vitest，node 环境',
  'docs:check': '提交的 ADR 索引与决策文件不一致时失败；云端任务跑这一条',
  'changelog:check': '提交的 `[Unreleased]` 段与 `docs/changes/` 不一致时失败；云端任务跑这一条',
  agents: '从 `package.json` 与每个脚本自己的头部写出这张表',
  'agents:check': 'AGENTS.md 的命令表与 `package.json` 不一致时失败；云端任务跑这一条',
}

/** 一条命令指向一个脚本文件时，那个文件的路径。 */
const SCRIPT_FILE = /^node\s+(\S+\.(?:mjs|cjs))(?:\s|$)/

/**
 * 一个脚本在自己的头部写下的用途：写着文件名再破折号的那一句，截到第一句，去掉末尾的决策引用。
 *
 * @param file - 相对仓库根的文件。
 * @returns 用途；文件头部没有写时是 null。
 */
function statedPurpose(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const block = text.match(/\/\*\*([\s\S]*?)\*\//)
  if (block === null) return null
  const paragraph = block[1].split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, '').trim())
    .join(' ')
    .trim()
  const after = paragraph.split('—').slice(1).join('—').trim()
  if (after === '') return null
  const sentence = after.match(/^.*?[.。](?=\s|$)/)
  const purpose = (sentence === null ? after : sentence[0])
    .replace(/\s*（D\d+）。?$/, '')
    .replace(/\s*\(D\d+\)\.?$/, '')
    .replace(/[。.]$/, '')
  return purpose === '' ? null : purpose
}

/**
 * 表本身：按声明次序一条一行。
 *
 * @returns 若干行 Markdown。
 */
function table() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const rows = ['| 命令 | 做什么 |', '|---|---|']
  rows.push('| `npm install` | 开发依赖：TypeScript、esbuild、jscpd、Vitest、Playwright 与 React 的类型；安装时 `prepare` 顺带构建一次 |')
  for (const [name, command] of Object.entries(pkg.scripts)) {
    // `prepare` 是安装时自己跑的生命周期脚本，不是给人敲的命令。
    if (name === 'prepare') continue
    const override = OVERRIDES[name]
    const file = command.match(SCRIPT_FILE)?.[1]
    const purpose = override ?? (file === undefined ? null : statedPurpose(file))
    if (purpose === null) throw new Error(`agents: npm run ${name} 跑的是 "${command}"，它没有写用途——把它加进 scripts/agents-commands.mjs 的 OVERRIDES`)
    rows.push(`| \`${name === 'test' ? 'npm test' : `npm run ${name}`}\` | ${purpose} |`)
  }
  return rows.join('\n')
}

/** 提交的表（连同标记）；没有标记时抛出要加哪两行。 */
function committed() {
  const text = fs.readFileSync(AGENTS, 'utf8')
  const start = text.indexOf(START)
  const end = text.indexOf(END)
  if (start === -1 || end === -1) throw new Error(`agents: AGENTS.md 里没有命令表的标记，把这两行加在表该在的地方：\n  ${START}\n  ${END}`)
  return text.slice(start, end + END.length)
}

/** 整块区域，含两个标记。 */
function section() {
  return [START, '', table(), '', END].join('\n')
}

if (process.argv.includes('--print')) {
  console.log(section())
} else if (process.argv.includes('--check')) {
  if (committed() !== section()) {
    console.error('agents: AGENTS.md 的命令表与 package.json 说的不一致；跑 `npm run agents`')
    process.exitCode = 1
  } else {
    console.log('agents: 命令表是最新的')
  }
} else {
  const text = fs.readFileSync(AGENTS, 'utf8')
  const start = text.indexOf(START)
  const end = text.indexOf(END)
  if (start === -1 || end === -1) throw new Error(`agents: AGENTS.md 里没有命令表的标记，把这两行加上：\n  ${START}\n  ${END}`)
  const next = text.slice(0, start) + section() + text.slice(end + END.length)
  if (next === text) {
    console.log('agents: AGENTS.md 的命令表已经与 package.json 一致')
  } else {
    fs.writeFileSync(AGENTS, next)
    console.log('agents: 写出了 AGENTS.md 的命令表')
  }
}
