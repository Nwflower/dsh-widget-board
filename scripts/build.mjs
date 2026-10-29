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
 *   lib/provider.js         提供方 SDK：`./provider` 的值入口，两侧的提供方都打包它（D31）。
 *   lib/types/              `./service` 与 `./provider` 的声明，由 `tsconfig.types.json` 写出。
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
const WIDGETS_EXAMPLES = path.join(ROOT, 'packages', 'widgets-examples')
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

/** 宿主的模块表交给浏览器半边的包：留在产物里，由加载器的 `require` 解析。 */
const HOST_CLIENT_PACKAGES = ['react', 'react/jsx-runtime', 'react-dom/client']

/**
 * 宿主模块表在启动时冻结的平台种子（与宿主 Web shell 的静态表一致）。浏览器半边的产物只能取
 * 这些模块或本包自己的分块；功能插件不能值导入另一个插件的包。
 */
const CLIENT_BASELINE = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

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
  try {
    execFileSync(process.execPath, [TSC, '-p', path.join(ROOT, project), '--pretty'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  } catch (error) {
    throw new Error(`build: 类型检查 ${project} 失败：\n${error.stdout ?? ''}${error.stderr ?? ''}`)
  }
}

/**
 * 写出 `./service` 的类型入口：声明从 `contracts` 生成，里面没有运行时代码。
 *
 * 提供方用 `import type` 取这份声明，编译时被抹掉；运行时仍只经服务调用。
 */
function emitServiceTypes() {
  try {
    execFileSync(process.execPath, [TSC, '-p', path.join(ROOT, 'tsconfig.types.json'), '--pretty'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  } catch (error) {
    throw new Error(`build: 写出服务类型入口失败：\n${error.stdout ?? ''}${error.stderr ?? ''}`)
  }
}


/**
 * `./provider` 的值入口：提供方的纯构造函数。产物里不能出现宿主实现、模块系统或全局状态——它是
 * 同一份代码被打进两种运行位置（D2、D31）。
 *
 * @param code - `lib/provider.js` 的文本。
 */
function checkProviderSdk(code) {
  const forbidden = ['node:', '@dsh-widget-board/host', '@dsh-widget-board/client', '@dsh-widget-board/runtime', 'process.', 'globalThis', 'window.', 'document.']
  for (const needle of forbidden) {
    if (code.includes(needle)) throw new Error(`build: lib/provider.js 里出现了 ${needle}；提供方 SDK 只构造形状（D31）`)
  }
}

/** 提供方 SDK：一份 ESM，宿主进程与浏览器半边打包的是同一个入口。 */
async function buildProviderSdk() {
  const code = await output({
    entryPoints: [path.join(ROOT, 'packages', 'contracts', 'src', 'provider.ts')],
    outfile: path.join(LIB, 'provider.js'),
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'esnext',
    legalComments: 'none',
  }, '.js')
  checkProviderSdk(code)
  writeAtomic(path.join(LIB, 'provider.js'), code)
  return Buffer.byteLength(code)
}

/**
 * 浏览器半边的运行边界：功能插件不添加 `dsh.client.external`，产物里的 `require` 只落平台种子
 * 或本包分块。值导入另一个包会带进第二份实现，或者在模块表上落空。
 *
 * @param code - `lib/client.js` 的文本。
 */
function checkClientBoundary(code) {
  const external = PACKAGE.dsh?.client?.external
  if (Array.isArray(external) && external.length > 0) {
    throw new Error(`build: dsh.client.external 不能用于功能插件：${external.join('、')}（D2）`)
  }
  const allowed = new Set(CLIENT_BASELINE)
  for (const match of code.matchAll(/\brequire\((["'])([^"']+)\1\)/g)) {
    const specifier = match[2]
    if (allowed.has(specifier) || specifier.startsWith('./')) continue
    throw new Error(`build: lib/client.js require 了 ${specifier}；浏览器半边只能取平台种子或本包分块（D2）`)
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

/**
 * 先写临时文件再改名：宿主与在线的页面随时可能在读 `lib/`，读到写了一半的产物就等于把一份坏
 * 资产发了出去。
 *
 * @param file - 目标路径。
 * @param text - 文件内容。
 */
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  fs.writeFileSync(temporary, text)
  fs.renameSync(temporary, file)
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
  checkClientBoundary(code)
  writeAtomic(path.join(LIB, 'client.js'), code)
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
  writeAtomic(path.join(LIB, 'host', 'index.js'), code)
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
  writeAtomic(path.join(LIB, 'runtime', 'runtime.js'), code)
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

/** 把组件套件、精选库与内置组件放进 lib/，并按令牌生成样式表。 */
function writeAssets() {
  writeAtomic(path.join(LIB, 'runtime', 'suite.css'), fs.readFileSync(path.join(RUNTIME, 'suite', 'suite.css'), 'utf8'))
  writeAtomic(path.join(LIB, 'runtime', 'tokens.css'), tokenCss(TOKENS))
  // 组件树先拷到旁边再改名：逐个文件出现的过程中，宿主读到的组件可能是半份。
  const staging = path.join(LIB, '.widgets-staging')
  fs.cpSync(WIDGETS, staging, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules`) })
  fs.renameSync(staging, path.join(LIB, 'widgets'))
  // 示例组件（D17）：目录可能还不存在，那时 lib/widgets-examples 就缺席，宿主按空来源算。
  if (fs.existsSync(WIDGETS_EXAMPLES)) {
    const examplesStaging = path.join(LIB, '.widgets-examples-staging')
    fs.cpSync(WIDGETS_EXAMPLES, examplesStaging, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules`) })
    fs.renameSync(examplesStaging, path.join(LIB, 'widgets-examples'))
  }
}

/**
 * 精选库：组件在 manifest 的 `libs` 里点名，宿主把这里写出的脚本内联进组件文档（D7）。
 *
 * 每个库是一份 IIFE，挂到 `window` 上；组件拿到的就是那个全局，不需要自己的打包步骤。
 */
const LIBS = [
  { id: 'marked', entry: path.join(RUNTIME, 'libs', 'marked.ts') },
  { id: 'highlight', entry: path.join(RUNTIME, 'libs', 'highlight.ts') },
  { id: 'three', entry: path.join(RUNTIME, 'libs', 'three.ts') },
]

/**
 * 写出精选库。
 *
 * @returns 每个库的字节数，按 id 索引。
 */
async function buildLibs() {
  const sizes = {}
  for (const lib of LIBS) {
    const code = await output({
      entryPoints: [lib.entry],
      outfile: path.join(LIB, 'runtime', 'libs', `${lib.id}.js`),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'esnext',
      minify: true,
      legalComments: 'none',
    }, '.js')
    writeAtomic(path.join(LIB, 'runtime', 'libs', `${lib.id}.js`), code)
    sizes[lib.id] = Buffer.byteLength(code)
  }
  return sizes
}

typecheck('tsconfig.json')
typecheck('tsconfig.host.json')
fs.rmSync(LIB, { recursive: true, force: true })
fs.mkdirSync(LIB, { recursive: true })
emitServiceTypes()
const provider = await buildProviderSdk()
const client = await buildClientHalf()
const host = await buildHostHalf()
const runtime = await buildRuntime()
writeAssets()
const libs = await buildLibs()
console.log(`build: lib/client.js ${client} 字节，lib/host/index.js ${host} 字节，lib/runtime/runtime.js ${runtime} 字节，lib/provider.js ${provider} 字节，精选库 ${Object.entries(libs).map(([id, size]) => `${id} ${size}`).join('，')} 字节，内置组件已就位，服务与提供方的类型入口已写出`)
