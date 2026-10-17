#!/usr/bin/env node
/**
 * verify.mjs — 测试的唯一入口（D13）。
 *
 * 一道关一道关地跑，每道关自己说出结果，第一道没过就停下并报出是哪一道：
 *
 *   检查   lint、ADR 索引、CHANGELOG 的 [Unreleased] 段、AGENTS.md 的命令表
 *   构建   类型检查与两个半边的产物；单元层与冒烟都读它写出的东西
 *   单元   vitest 跑一遍
 *   冒烟   在真实的临时宿主里打开看板（慢，`--no-smoke` 跳过）
 *
 * 用法：node scripts/verify.mjs [--no-smoke | --help]
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const NO_SMOKE = process.argv.includes('--no-smoke')

const seconds = (started) => `${((Date.now() - started) / 1000).toFixed(1)} 秒`

/** 跑一条命令；输出照原样打出，非零退出就是这一关没过。 */
function run([command, args]) {
  return spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' }).status === 0
}

const node = (script, args = []) => [process.execPath, [path.join(ROOT, script), ...args]]
const vitest = [process.execPath, [path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run']]

/** 一道关：标题、怎么跑、跑多久。 */
const gates = [
  { title: 'lint', command: () => node('scripts/lint.mjs') },
  { title: 'ADR 索引', command: () => node('scripts/decisions-index.mjs', ['--check']) },
  { title: 'CHANGELOG 的 [Unreleased] 段', command: () => node('scripts/changelog.mjs', ['--check']) },
  { title: 'AGENTS.md 的命令表', command: () => node('scripts/agents-commands.mjs', ['--check']) },
  { title: '构建', command: () => node('scripts/build.mjs') },
  { title: '单元层', command: () => vitest },
  { title: '真实宿主里的冒烟', command: () => node('packages/testing/smoke.cjs'), skip: NO_SMOKE },
]

if (process.argv.includes('--help')) {
  console.log('用法：node scripts/verify.mjs [--no-smoke]\n  --no-smoke  跳过要起真实宿主的冒烟；其余各关照跑。')
  process.exit(0)
}

for (const gate of gates) {
  if (gate.skip === true) {
    console.log(`\nverify: ${gate.title} 跳过（--no-smoke）`)
    continue
  }
  const started = Date.now()
  console.log(`\nverify: ${gate.title}`)
  if (!run(gate.command())) {
    console.error(`\nverify: 卡在「${gate.title}」这一关`)
    process.exit(1)
  }
  console.log(`verify: ${gate.title} 通过（${seconds(started)}）`)
}
console.log('\nverify: 全部通过')
