#!/usr/bin/env node
/**
 * check-provider-types.mjs — 提供方两个入口的三条判据（D31）。
 *
 * 类型侧：服务入口的 fixture 用 `import type` 取类型，取值导入被 `@ts-expect-error` 挡下；入口里要是
 * 多出一个运行时的值，那条抑制反而会报「没有用到」。
 * 运行时侧：服务入口的 fixture 打一次，产物里不能留下该模块的导入或 require。
 * 值侧：提供方 SDK 的 fixture 类型检查、打包，产物里不能有宿主实现、模块系统或全局状态，再把它
 * import 回来跑一遍版本与功能校验。
 *
 * 用法：node scripts/check-provider-types.mjs
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import esbuild from 'esbuild'

const ROOT = path.resolve(import.meta.dirname, '..')
const FIXTURES = path.join(ROOT, 'packages', 'testing', 'fixtures')
const TYPE_FIXTURE = path.join(FIXTURES, 'provider-types')
const VALUE_FIXTURE = path.join(FIXTURES, 'provider-values')
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

/** 提供方 SDK 的产物里不该出现的东西：宿主实现、模块系统、全局状态。 */
const FORBIDDEN = ['node:', '@dsh-widget-board/host', '@dsh-widget-board/client', '@dsh-widget-board/runtime', 'dsh-widget-board/service', 'process.', 'globalThis', 'window.', 'document.']

/** 只挂在把手与旧入口上的批量资源：`registerProvider` 的入参里不该出现这些字段。 */
const BULK = ['directories', 'sources', 'actions', 'capabilities', 'markets', 'widgets']

/** 跑一次 tsc；失败时把它的输出原样抛出。 */
function typecheckFixture(directory) {
  try {
    execFileSync(process.execPath, [TSC, '-p', path.join(directory, 'tsconfig.json'), '--pretty'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  } catch (error) {
    console.error('check-provider-types: ' + path.basename(directory) + ' 类型检查失败：\n' + (error.stdout ?? '') + (error.stderr ?? ''))
    process.exit(1)
  }
}

/** 打一次 fixture，返回产物文本。 */
async function bundle(entry) {
  const { outputFiles } = await esbuild.build({
    entryPoints: [entry],
    outfile: path.join(path.dirname(entry), 'provider.js'),
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
  return outputFiles[0]?.text ?? ''
}

/** 一条判据：产物里出现了不该有的东西就退出。 */
function rejectNeedles(code, needles, reason) {
  for (const needle of needles) {
    if (!code.includes(needle)) continue
    console.error('check-provider-types: 产物里出现了 ' + needle + '；' + reason)
    process.exit(1)
  }
}

/** 一条判据：这一次调用必须抛出。 */
function expectThrow(label, work) {
  try {
    work()
  } catch {
    return
  }
  console.error('check-provider-types: ' + label + ' 没有被拒绝')
  process.exit(1)
}

/** 一条判据：值必须相等。 */
function expectEqual(label, actual, expected) {
  if (actual === expected) return
  console.error('check-provider-types: ' + label + ' 是 ' + String(actual) + '，应当是 ' + String(expected))
  process.exit(1)
}

typecheckFixture(TYPE_FIXTURE)
const typesCode = await bundle(path.join(TYPE_FIXTURE, 'provider.ts'))
rejectNeedles(typesCode, ['dsh-widget-board/service'], '类型导入没有被抹掉')

typecheckFixture(VALUE_FIXTURE)
const valuesCode = await bundle(path.join(VALUE_FIXTURE, 'provider.ts'))
rejectNeedles(valuesCode, FORBIDDEN, '提供方 SDK 只能构造形状（D31）')

const sdk = await import('data:text/javascript;base64,' + Buffer.from(valuesCode).toString('base64'))
expectEqual('注册的提供方', sdk.registration.provider, 'dsh-widget-board-provider-values')
expectEqual('注册的版本', sdk.registration.apiVersion, 3)
expectEqual('宿主侧注册只报身份与用途', BULK.some((field) => field in sdk.registration), false)
expectEqual('浏览器侧注册只报身份与用途', BULK.some((field) => field in sdk.nativeRegistrationValue), false)
expectEqual('去重后的功能数', sdk.identity.features.length, 2)
expectEqual('注册是否冻结', Object.isFrozen(sdk.registration), true)
expectThrow('版本 2 的注册', () => sdk.defineProvider({ provider: 'x', apiVersion: 2 }))
expectThrow('未知的功能名', () => sdk.defineProvider({ provider: 'x', features: ['nope'] }))
expectThrow('空的提供方名', () => sdk.defineProvider({ provider: ' ' }))
expectThrow('手工构造的身份里的未知功能', () => sdk.providerRegistration({ provider: 'x', apiVersion: 3, features: ['nope'] }))
expectThrow('没有 read 的数据源', () => sdk.sourceRegistration({ id: 'broken' }))

console.log('check-provider-types: 服务入口只有类型、取值导入被拒绝；提供方 SDK 可取值、可打包，产物里没有宿主实现与全局状态')
