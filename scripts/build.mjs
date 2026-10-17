#!/usr/bin/env node
/**
 * build.mjs — 写出宿主半边、浏览器半边、组件运行时与内置组件，类型检查是其中一步（D2）。
 *
 * 产物与它们的去处由宿主定：
 *
 *   lib/host/index.js       ESM，宿主进程按 `exports["."]` 导入，由它调用 `apply(ctx)`。
 *                           `@deepseek-ai/*` 由宿主进程提供，其余（Ajv 等）内联进这一份。
 *   lib/client.js           CJS，包在加载器工厂里（`window.__ModuleLoader__.load`）。
 *                           React 由宿主的模块表提供，不打进产物。
 *   lib/runtime/runtime.js  组件 iframe 里跑的运行时，由宿主内联进每份组件文档（D3）。
 *   lib/runtime/tokens.css  由 `contracts/tokens.json` 生成的令牌（D10）。
 *   lib/runtime/suite.css   组件套件的动效原语与基础件。
 *   lib/widgets/<id>/       内置组件，格式与用户组件相同（D7）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import esbuild from 'esbuild'

const ROOT = path.resolve(import.meta.dirname, '..')
const LIB = path.join(ROOT, 'lib')
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const TOKENS = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'contracts', 'tokens.json'), 'utf8'))
const RUNTIME = path.join(ROOT, 'packages', 'runtime', 'src')
const WIDGETS = path.join(ROOT, 'packages', 'widgets')

/** 宿主的模块表交给浏览器半边的包：留在产物里，由加载器的 `require` 解析。 */
const HOST_CLIENT_PACKAGES = ['react', 'react/jsx-runtime', 'react-dom/client']

/** 宿主进程提供的包：留在产物里，由宿主按自己的 node_modules 解析。 */
const HOST_NODE_PACKAGES = ['@deepseek-ai/*']

/**
 * 加载器工厂的包装：`require` 解析宿主提供的包，产物的 `module.exports` 就是加载器拿到的插件导出。
 */
const FACTORY_OPEN = `/**
 * ${PACKAGE.name} — ${PACKAGE.description}
 * GENERATED FILE — 不要编辑。源码在 packages/client/src/，由 \`npm run build\` 打包。
 */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PACKAGE.name)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports`
const FACTORY_CLOSE = `    return module.exports
  },
})`

/** 跑一次 tsc；失败时把它的输出原样抛出。 */
function typecheck(project) {
  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  try {
    execFileSync(process.execPath, [tsc, '-p', path.join(ROOT, project), '--pretty'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  } catch (error) {
    throw new Error(`build: 类型检查 ${project} 失败：\n${error.stdout ?? ''}${error.stderr ?? ''}`)
  }
}

/**
 * 取一次 esbuild 的输出。
 *
 * @param options - esbuild 的配置。
 * @param extension - 要取的产物后缀。
 * @returns 产物的文本。
 */
async function output(options, extension) {
  const { outputFiles } = await esbuild.build({ write: false, logLevel: 'silent', ...options })
  const file = outputFiles.find((candidate) => candidate.path.endsWith(extension))
  if (file === undefined) throw new Error(`build: esbuild 没有写出 ${extension} 产物`)
  return file.text
}

/** 浏览器半边。 */
async function buildClientHalf() {
  const code = await output({
    entryPoints: [path.join(ROOT, 'packages', 'client', 'src', 'entry.ts')],
    outfile: path.join(LIB, 'client.js'),
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'esnext',
    minify: true,
    sourcemap: 'linked',
    external: HOST_CLIENT_PACKAGES,
    jsx: 'automatic',
    loader: { '.css': 'text' },
    banner: { js: FACTORY_OPEN },
    footer: { js: FACTORY_CLOSE },
  }, '.js')
  fs.writeFileSync(path.join(LIB, 'client.js'), code)
  return Buffer.byteLength(code)
}

/** 宿主半边：Ajv 与仓库内的包内联，宿主提供的包留在产物里。 */
async function buildHostHalf() {
  const code = await output({
    entryPoints: [path.join(ROOT, 'packages', 'host', 'src', 'index.ts')],
    outfile: path.join(LIB, 'host', 'index.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    external: HOST_NODE_PACKAGES,
  }, '.js')
  fs.mkdirSync(path.join(LIB, 'host'), { recursive: true })
  fs.writeFileSync(path.join(LIB, 'host', 'index.js'), code)
  return Buffer.byteLength(code)
}

/** 组件 iframe 里跑的运行时。 */
async function buildRuntime() {
  const code = await output({
    entryPoints: [path.join(RUNTIME, 'index.ts')],
    outfile: path.join(LIB, 'runtime', 'runtime.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'esnext',
    minify: true,
  }, '.js')
  fs.mkdirSync(path.join(LIB, 'runtime'), { recursive: true })
  fs.writeFileSync(path.join(LIB, 'runtime', 'runtime.js'), code)
  return Buffer.byteLength(code)
}

/**
 * 令牌样式表：只有字面值进 CSS，引用宿主变量的令牌由宿主经 `init` 递进 iframe（D10）。
 *
 * 引用那些令牌时 `var(--w-…, 回退值)` 必须能在首帧用上回退值；写成一条解析不出值的声明反而会
 * 让回退失效，所以它们不进静态样式表。
 *
 * @param tokens - `contracts/tokens.json`。
 * @returns CSS 文本。
 */
function tokenCss(tokens) {
  const lines = ['/* 由 packages/contracts/tokens.json 生成，勿手改（D10）。 */', ':root {']
  for (const [group, entries] of Object.entries(tokens)) {
    for (const [name, value] of Object.entries(entries)) {
      if (/^var\(/.test(value)) continue
      lines.push(`  --w-${group}-${name}: ${value};`)
    }
  }
  lines.push('}')
  return `${lines.join('\n')}\n`
}

/** 把组件套件与内置组件放进 lib/，并按令牌生成样式表。 */
function writeAssets() {
  fs.mkdirSync(path.join(LIB, 'runtime'), { recursive: true })
  fs.copyFileSync(path.join(RUNTIME, 'suite', 'suite.css'), path.join(LIB, 'runtime', 'suite.css'))
  fs.writeFileSync(path.join(LIB, 'runtime', 'tokens.css'), tokenCss(TOKENS))
  fs.cpSync(WIDGETS, path.join(LIB, 'widgets'), { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules`) })
}

typecheck('tsconfig.json')
typecheck('tsconfig.host.json')
fs.rmSync(LIB, { recursive: true, force: true })
fs.mkdirSync(LIB, { recursive: true })
const client = await buildClientHalf()
const host = await buildHostHalf()
const runtime = await buildRuntime()
writeAssets()
console.log(`build: lib/client.js ${client} 字节，lib/host/index.js ${host} 字节，lib/runtime/runtime.js ${runtime} 字节，内置组件已就位`)
