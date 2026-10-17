#!/usr/bin/env node
/**
 * build.mjs — 写出宿主半边与浏览器半边，类型检查是其中一步（D2）。
 *
 * 两个半边的形状由宿主的加载器决定，不由本仓库决定：
 *
 *   lib/host/index.js   ESM，宿主进程按 `exports["."]` 导入，由它调用 `apply(ctx)`。
 *                       契约与模型（`@dsh-widget-board/contracts`、`…/model`）内联进这一份，
 *                       其余裸导入留在产物里，由宿主进程按自己的 node_modules 解析。
 *   lib/client.js      CJS，包在加载器工厂里（`window.__ModuleLoader__.load`），
 *                       由宿主的浏览器半边取 `factory(require)` 的返回值当作插件导出。
 *                       React 由宿主的模块表提供，不打进产物。
 *
 * 产物写到 `lib/`，那是构建输出、从不提交（D2）。CLI 与 dev.mjs 都调用本文件。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import esbuild from 'esbuild'

const ROOT = path.resolve(import.meta.dirname, '..')
const LIB = path.join(ROOT, 'lib')
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

/**
 * 宿主的模块表交给浏览器半边的包：留在产物里，由加载器的 `require` 解析。
 * 出处是宿主 shell 的静态模块表（`dsh-web-frontend` 的启动代码），改这里之前先核对那张表。
 */
const HOST_PACKAGES = ['react', 'react/jsx-runtime', 'react-dom/client']

/** 内联进每个半边的仓库内包：它们不是发布物的一部分，裸导入留在产物里无法解析。 */
const INLINED = [
  { name: '@dsh-widget-board/contracts', dir: path.join(ROOT, 'packages', 'contracts', 'src') },
  { name: '@dsh-widget-board/model', dir: path.join(ROOT, 'packages', 'model', 'src') },
]

/** 这个裸标识符是不是某个内联包的入口或子路径。 */
const inlinedSpecifier = (specifier) => INLINED.some(({ name }) => specifier === name || specifier.startsWith(`${name}/`))

/**
 * 只把宿主提供的包留在产物里：入口、仓库内的包，以及内联包之间的相对导入都走打包，
 * 其余一律 external。
 */
const externalButInlined = {
  name: 'external-but-inlined',
  setup(build) {
    const inlined = (args) => args.kind === 'entry-point'
      || inlinedSpecifier(args.path)
      || (args.path.startsWith('.') && INLINED.some(({ dir }) => args.importer.startsWith(dir)))
    build.onResolve({ filter: /.*/ }, (args) => (inlined(args) ? undefined : { path: args.path, external: true }))
  },
}

/**
 * 加载器工厂的包装：`require` 解析宿主提供的包，产物的 `module.exports` 就是加载器
 * 拿到的插件导出（任务看板的 `lib/client.js` 是同一形状）。
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

/** 跑一次 tsc；失败时把它的输出原样抛出，不吞掉。 */
function typecheck(project) {
  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  try {
    execFileSync(process.execPath, [tsc, '-p', path.join(ROOT, project), '--pretty'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  } catch (error) {
    throw new Error(`build: 类型检查 ${project} 失败：\n${error.stdout ?? ''}${error.stderr ?? ''}`)
  }
}

/**
 * 打包浏览器半边并写出 `lib/client.js`。
 *
 * @returns 写出的字节数。
 */
async function buildClientHalf() {
  const { outputFiles } = await esbuild.build({
    entryPoints: [path.join(ROOT, 'packages', 'client', 'src', 'entry.ts')],
    outfile: path.join(LIB, 'client.js'),
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'esnext',
    logLevel: 'silent',
    minify: true,
    sourcemap: 'linked',
    external: HOST_PACKAGES,
    jsx: 'automatic',
    loader: { '.css': 'text' },
    banner: { js: FACTORY_OPEN },
    footer: { js: FACTORY_CLOSE },
  })
  const code = outputFiles.find((file) => file.path.endsWith('.js'))?.text
  const map = outputFiles.find((file) => file.path.endsWith('.map'))?.text
  if (code === undefined || map === undefined) throw new Error('build: esbuild 没有写出 client.js 与它的 sourcemap')
  fs.writeFileSync(path.join(LIB, 'client.js'), code)
  fs.writeFileSync(path.join(LIB, 'client.js.map'), map)
  return Buffer.byteLength(code)
}

/**
 * 打包宿主半边并写出 `lib/host/index.js`。
 *
 * @returns 写出的字节数。
 */
async function buildHostHalf() {
  const { outputFiles } = await esbuild.build({
    entryPoints: [path.join(ROOT, 'packages', 'host', 'src', 'index.ts')],
    outfile: path.join(LIB, 'host', 'index.js'),
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
    sourcemap: 'linked',
    plugins: [externalButInlined],
  })
  const code = outputFiles.find((file) => file.path.endsWith('.js'))?.text
  const map = outputFiles.find((file) => file.path.endsWith('.map'))?.text
  if (code === undefined || map === undefined) throw new Error('build: esbuild 没有写出 host/index.js 与它的 sourcemap')
  fs.mkdirSync(path.join(LIB, 'host'), { recursive: true })
  fs.writeFileSync(path.join(LIB, 'host', 'index.js'), code)
  fs.writeFileSync(path.join(LIB, 'host', 'index.js.map'), map)
  return Buffer.byteLength(code)
}

typecheck('tsconfig.json')
typecheck('tsconfig.host.json')
fs.rmSync(LIB, { recursive: true, force: true })
fs.mkdirSync(LIB, { recursive: true })
const client = await buildClientHalf()
const host = await buildHostHalf()
console.log(`build: lib/client.js ${client} 字节，lib/host/index.js ${host} 字节，类型检查通过`)
