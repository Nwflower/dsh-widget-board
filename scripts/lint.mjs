#!/usr/bin/env node
/**
 * lint.mjs — 不需要构建就能查的规则。
 *
 * 仓库在文档里许下的、工具能自己判定的那些：没有源文件越过停止线，提交进的文档里的链接都指到
 * 存在的文件，代码与文档引用的决策编号都存在，包之间的依赖方向不倒过来，浏览器半边不在插件的
 * 根节点之外查文档，导入不包在 try/catch 里，没有两份文件共用一段抄来的代码（jscpd）。
 *
 * 用法：node scripts/lint.mjs
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DECISIONS = path.join(ROOT, 'docs', 'adr')
/** 停止线：源文件接近这个行数就拆分，不再往里加功能（D2）。 */
const MAX_LINES = 750
/** 不走进去的目录：本地草稿、产物与依赖。 */
const SKIPPED = new Set(['.git', '.debug', '.claude', 'node_modules', 'lib'])

const problems = []

const relative = (file) => path.relative(ROOT, file).replace(/\\/g, '/')

/**
 * 某个目录下所有带指定后缀的文件。
 *
 * @param dir - 要走的目录。
 * @param extensions - 后缀列表，如 `['.ts', '.tsx']`。
 * @returns 绝对路径的数组。
 */
function filesUnder(dir, extensions) {
  const found = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIPPED.has(entry.name)) continue
        walk(path.join(current, entry.name))
      } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
        found.push(path.join(current, entry.name))
      }
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return found
}

/**
 * 仓库里活着的决策编号，以及被取代掉的编号。
 *
 * 编号永不复用：退役但没有后继的编号写在 `retired.txt` 里，一行一个。
 *
 * @returns `{ live, retired }` 两个编号集合。
 */
function decisionNumbers() {
  const live = new Set()
  const retired = new Set()
  for (const name of fs.readdirSync(DECISIONS)) {
    if (!/^D\d+-.*\.md$/.test(name)) continue
    live.add(Number(name.match(/^D(\d+)/)[1]))
    const text = fs.readFileSync(path.join(DECISIONS, name), 'utf8')
    const replaced = text.match(/^- \*\*取代\*\*：(.+)$/m)
    if (replaced !== null) for (const number of replaced[1].matchAll(/D(\d+)/g)) retired.add(Number(number[1]))
  }
  const retiredFile = path.join(DECISIONS, 'retired.txt')
  if (fs.existsSync(retiredFile)) {
    fs.readFileSync(retiredFile, 'utf8').split('\n').forEach((line, at) => {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) return
      const entry = trimmed.match(/^D(\d+)$/)
      if (entry === null) {
        problems.push(`docs/adr/retired.txt:${at + 1}: 不是单独的编号：${trimmed}`)
        return
      }
      retired.add(Number(entry[1]))
    })
  }
  return { live, retired }
}

const sources = [
  ...filesUnder(path.join(ROOT, 'packages'), ['.ts', '.tsx', '.css', '.cjs', '.js']),
  ...filesUnder(path.join(ROOT, 'scripts'), ['.mjs', '.cjs', '.js']),
].filter((file) => !/\.test\.tsx?$/.test(file) && !/\.d\.ts$/.test(file))

const markdown = filesUnder(ROOT, ['.md']).filter((file) => !relative(file).startsWith('.debug/'))

/** 一个包的源码文件，按包名分组。 */
const sourcesOf = (name) => sources.filter((file) => relative(file).startsWith(`packages/${name}/`))

/** 一份源码里出现的模块标识符：`from` 之后的部分与副作用导入，多行导入同样算。 */
function importsOf(file) {
  const text = fs.readFileSync(file, 'utf8')
  const specifiers = []
  for (const match of text.matchAll(/\bfrom\s+'([^']+)'/g)) specifiers.push(match[1])
  for (const match of text.matchAll(/\bimport\s*\(\s*'([^']+)'/g)) specifiers.push(match[1])
  for (const match of text.matchAll(/^\s*import\s+'([^']+)'/gm)) specifiers.push(match[1])
  return specifiers
}

// 1. 停止线。
for (const file of sources) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').length
  if (lines > MAX_LINES) problems.push(`${relative(file)}: ${lines} 行，越过 ${MAX_LINES} 行的停止线`)
}

// 2. 已经提交的文档里的相对链接。
let links = 0
for (const file of markdown) {
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1]
    if (/^(?:https?:|mailto:|#)/.test(target)) continue
    const [clean] = target.split('#')
    if (clean === '') continue
    links += 1
    if (!fs.existsSync(path.resolve(path.dirname(file), decodeURIComponent(clean)))) {
      problems.push(`${relative(file)}: 链接 ${target} 指不到任何文件`)
    }
  }
}

// 3. 代码与文档引用的决策编号。
const { live, retired } = decisionNumbers()
let citations = 0
for (const file of [...sources, ...markdown, path.join(ROOT, 'AGENTS.md')].filter((file) => fs.existsSync(file))) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, at) => {
    for (const match of line.matchAll(/(?<![\w#-])D(\d{1,3})(?![\w-])/g)) {
      citations += 1
      const number = Number(match[1])
      if (live.has(number) || retired.has(number)) continue
      problems.push(`${relative(file)}:${at + 1}: 引用 D${number}，没有这条决策`)
    }
  })
}

// 4. 包之间的依赖方向（D2）：模型的纯逻辑不碰界面，运行时不依赖浏览器半边，宿主半边不导入
// 两边都不是自己该读的东西。
const FORBIDDEN = [
  { pkg: 'model', into: ['host', 'client', 'runtime'], why: 'model 是纯逻辑，不碰界面与宿主' },
  { pkg: 'runtime', into: ['client', 'host'], why: '组件运行时只读 contracts' },
  { pkg: 'host', into: ['client', 'runtime'], why: '宿主半边不导入浏览器半边' },
  { pkg: 'client', into: ['host', 'runtime'], why: '浏览器半边不导入宿主半边' },
]
let directions = 0
for (const rule of FORBIDDEN) {
  for (const file of sourcesOf(rule.pkg)) {
    directions += 1
    for (const specifier of importsOf(file)) {
      for (const target of rule.into) {
        if (specifier === `@dsh-widget-board/${target}` || specifier.startsWith(`@dsh-widget-board/${target}/`)) {
          problems.push(`${relative(file)}: 导入了 ${specifier}；${rule.why}（D2）`)
        }
      }
    }
  }
}

// 5. 模型里不出现 DOM：它的输入输出都是纯数据，宿主算得出没有浏览器在线的布局（D2）。
let modelFiles = 0
for (const file of sourcesOf('model')) {
  modelFiles += 1
  const text = fs.readFileSync(file, 'utf8')
  for (const global of ['document', 'window', 'HTMLElement', 'ResizeObserver']) {
    if (new RegExp(`\\b${global}\\b`).test(text)) problems.push(`${relative(file)}: 出现了 ${global}；model 不碰 DOM（D2）`)
  }
}

// 6. 插件的根节点之外不查文档（D1）：浏览器半边的节点要么是自己建的，要么由宿主作为属性递过来。
const LOOKUP = /\bdocument\.(?:querySelector|querySelectorAll|getElementById|getElementsBy\w+)\s*\(/g
let lookups = 0
for (const file of sourcesOf('client')) {
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(LOOKUP)) {
    lookups += 1
    problems.push(`${relative(file)}: ${match[0]}；插件在自己的根节点之外查文档，宿主的节点要从属性或服务读（D1）`)
  }
}

// 7. 浏览器半边只拿宿主的类型（D1、D2）：`@deepseek-ai/*` 的值导入会带进第二份实现，或者在模块表
// 上落空；跨包行为走 cordis 服务，跨包界面走插槽。
const CLIENT_VALUE_IMPORT = /^\s*import\s+(?!type\b)(?:[^'"]*?)\bfrom\s+'(@deepseek-ai\/[^']+)'/gm
const CLIENT_SIDE_EFFECT_IMPORT = /^\s*import\s+'(@deepseek-ai\/[^']+)'/gm
const CLIENT_REQUIRE = /\brequire\(\s*'(@deepseek-ai\/[^']+)'\s*\)/g
let clientHostValues = 0
for (const file of sourcesOf('client')) {
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(CLIENT_VALUE_IMPORT)) {
    clientHostValues += 1
    problems.push(`${relative(file)}: 值导入了 ${match[1]}；浏览器半边对宿主包只写 import type（D1、D2）`)
  }
  for (const match of text.matchAll(CLIENT_SIDE_EFFECT_IMPORT)) {
    clientHostValues += 1
    problems.push(`${relative(file)}: 副作用导入了 ${match[1]}；浏览器半边对宿主包只写 import type（D1、D2）`)
  }
  for (const match of text.matchAll(CLIENT_REQUIRE)) {
    clientHostValues += 1
    problems.push(`${relative(file)}: require 了 ${match[1]}；浏览器半边对宿主包只写 import type（D1、D2）`)
  }
}

// 8. 导入不包在 try/catch 里（D11）：缺依赖就在加载时抛出来，不静默回退。
let guarded = 0
for (const file of sources) {
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split('\n')
  lines.forEach((line, at) => {
    if (!/\btry\s*\{/.test(line)) return
    guarded += 1
    for (const next of lines.slice(at, at + 6)) {
      if (/\b(?:import|require)\s*\(/.test(next)) {
        problems.push(`${relative(file)}:${at + 1}: try/catch 里有导入；需要的库直接导入，缺了就在启动时抛出来（D11）`)
        break
      }
    }
  })
}

// 9. 删除工作树只从 scripts/worktree.mjs 里发出（AGENTS.md）：工作树顶层的目录链接会让 git 递归
// 删掉链接指向的目录，也就是主树的 node_modules，再下一跳是工作区链接指向的 packages/*。
let worktreeRemovals = 0
for (const file of sources) {
  const text = fs.readFileSync(file, 'utf8')
  const calls = [...text.matchAll(/['"]worktree['"]\s*,\s*['"]remove['"]/g), ...text.matchAll(/git\s+worktree\s+remove/g)]
  if (calls.length === 0) continue
  if (relative(file) === 'scripts/worktree.mjs') worktreeRemovals += calls.length
  else problems.push(`${relative(file)}: 直接删除工作树；用 node scripts/worktree.mjs remove <路径>，它先摘掉链接再交给 git（AGENTS.md）`)
}

// 10. 安装时构建（D2）：`lib/` 不提交，而发布入口就在它下面，所以从源码装的包（git 依赖、本地
// 目录）只有安装时构建一次才有宿主半边；少了 `prepare`，装出来的包里没有 `lib/host/index.js`。
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const entries = []
const collectEntries = (value) => {
  if (typeof value === 'string') entries.push(value)
  else if (value !== null && typeof value === 'object') Object.values(value).forEach(collectEntries)
}
collectEntries(manifest.main)
collectEntries(manifest.exports)
const builtEntries = [...new Set(entries.map((entry) => entry.replace(/^\.\//, '')).filter((entry) => entry.startsWith('lib/')))]
if (builtEntries.length === 0) {
  problems.push('lint: package.json 里没有指向 lib/ 的发布入口，安装时构建的规则匹配不上')
} else if (manifest.scripts?.prepare !== 'node scripts/build.mjs') {
  problems.push(`lint: package.json 的 ${builtEntries.join('、')} 是构建产物（lib/ 不提交，D2），安装时必须构建；scripts.prepare 要跑 node scripts/build.mjs`)
}

// 11. 抄来的代码（jscpd，扫描范围见 .jscpd.json）：同一段逻辑出现第二处，就是它该进共享层的时候。
const copies = spawnSync(process.execPath, [
  path.join(ROOT, 'node_modules', 'jscpd', 'run-jscpd.js'),
  '--threshold', '0',
  '--fail-on-empty',
  '--reporters', 'console',
  '--no-colors',
], { cwd: ROOT, encoding: 'utf8' })
if (copies.status !== 0) {
  problems.push(`有抄来的代码；把共用的那部分移进共享层（npx jscpd 列出每一处）：\n${copies.stdout}${copies.stderr}`)
}

// 规则自己也要有东西可看：模式写坏了会永远通过。
if (links === 0) problems.push('lint: 没有检查到任何文档链接，链接的模式匹配不上')
if (citations === 0) problems.push('lint: 没有检查到任何决策编号，编号的模式匹配不上')
if (directions === 0) problems.push('lint: 没有检查到任何包的导入方向')
if (worktreeRemovals === 0) problems.push('lint: 没有检查到 scripts/worktree.mjs 里的工作树删除，模式匹配不上')
if (!/^\s*import\s+(?!type\b)(?:[^'"]*?)\bfrom\s+'(@deepseek-ai\/[^']+)'/m.test("import { x } from '@deepseek-ai/y'")) {
  problems.push('lint: 客户端宿主值导入的规则匹配不上')
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`lint: ${problem}`)
  console.error(`lint: ${problems.length} 处问题，查了 ${sources.length} 份源码与 ${markdown.length} 份文档`)
  process.exitCode = 1
} else {
  console.log(`lint: ${sources.length} 份源码、${markdown.length} 份文档、${links} 条链接、${citations} 处决策引用、${directions} 处包导入、${modelFiles} 份模型源码、${lookups} 处文档查询、${guarded} 处 try、${clientHostValues} 处客户端宿主值导入，全部通过（停止线 ${MAX_LINES} 行；${builtEntries.length} 条发布入口指向构建产物、安装时构建；没有抄来的代码）`)
}
