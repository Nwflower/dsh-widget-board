#!/usr/bin/env node
/**
 * check-provider-types.mjs — 提供方类型入口的两条判据（D12）。
 *
 * 类型侧：fixture 用 `import type` 取服务类型，取值导入被 `@ts-expect-error` 挡下；入口里要是多出
 * 一个运行时的值，那条抑制反而会报「没有用到」。
 * 运行时侧：把 fixture 打一次，产物里不能留下 `dsh-widget-board/service` 的导入或 require。
 *
 * 用法：node scripts/check-provider-types.mjs
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import esbuild from 'esbuild'

const ROOT = path.resolve(import.meta.dirname, '..')
const FIXTURE = path.join(ROOT, 'packages', 'testing', 'fixtures', 'provider-types')

/** 先跑一次 tsc；失败时把它的输出原样抛出。 */
function typecheckFixture() {
  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  try {
    execFileSync(process.execPath, [tsc, '-p', path.join(FIXTURE, 'tsconfig.json'), '--pretty'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  } catch (error) {
    console.error(`check-provider-types: 类型检查失败：\n${error.stdout ?? ''}${error.stderr ?? ''}`)
    process.exit(1)
  }
}

/** 打一次 fixture，核对类型导入没有变成运行时的请求。 */
async function checkBundle() {
  const { outputFiles } = await esbuild.build({
    entryPoints: [path.join(FIXTURE, 'provider.ts')],
    outfile: path.join(FIXTURE, 'provider.js'),
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
  const code = outputFiles[0]?.text ?? ''
  if (code.includes('dsh-widget-board/service')) {
    console.error('check-provider-types: 产物里留下了 dsh-widget-board/service；类型导入没有被抹掉')
    process.exit(1)
  }
}

typecheckFixture()
await checkBundle()
console.log('check-provider-types: 类型入口只有类型，取值导入被拒绝，产物里没有该模块的导入')
