#!/usr/bin/env node
/**
 * demo.mjs — 构建演示页：插件真实的看板加一个只读的浏览器端宿主，产物是一个可以直接放上静态托管的目录（D25）。
 *
 * 先跑一遍 `scripts/build.mjs`（演示页读它写出的运行时与内置组件），再做四件事：
 *
 *   1. 用真实宿主的组件库、第一次启动的看板和文档拼装写出 `demo-data/`：默认快照与每份组件文档。
 *   2. 把演示宿主打成 Service Worker（`sw.js`），它在浏览器里回答 `api/widget-board/…` 的请求。
 *   3. 把页面打成 `assets/page.js`：插件的浏览器半边、演示页的外壳与文案。
 *   4. 拷入 `index.html` 与样式。
 *
 * 产物写到 `--out` 或环境变量 `DEMO_OUT` 给的目录，缺省是 `.debug/demo/`。该目录里的 `media/`
 * 不动：录屏放在那里，重新构建不会清掉它。
 *
 * `--recording <文件>` 把录屏拷进 `media/` 并写进 `index.html` 的 `demo-recording`；不给时那一项留空，
 * 页面显示占位说明，之后手动改也行。
 *
 * 用法：node scripts/demo.mjs [--out <目录>] [--recording <文件>]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'

const ROOT = path.resolve(import.meta.dirname, '..')
const LIB = path.join(ROOT, 'lib')
const DEMO = path.join(ROOT, 'packages', 'demo', 'src')
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
const SCRATCH = path.join(ROOT, '.debug', 'demo-build')

const outFlag = process.argv.indexOf('--out')
const OUT = path.resolve(ROOT, outFlag === -1 ? (process.env.DEMO_OUT ?? path.join('.debug', 'demo')) : process.argv[outFlag + 1] ?? '')

const recordingFlag = process.argv.indexOf('--recording')
const RECORDING = recordingFlag === -1 ? undefined : path.resolve(process.argv[recordingFlag + 1] ?? '')

/** 构建会清掉重写的几项；`media/` 与其余文件留给用户。 */
const GENERATED = ['index.html', 'sw.js', 'assets', 'demo-data', 'api', '.nojekyll']

/** 跑一次 tsc；失败时把它的输出原样抛出。 */
function typecheck(project) {
  try {
    execFileSync(process.execPath, [TSC, '-p', path.join(ROOT, project), '--pretty'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  } catch (error) {
    throw new Error(`demo: 类型检查 ${project} 失败：\n${error.stdout ?? ''}${error.stderr ?? ''}`)
  }
}

/**
 * 演示宿主复用真实宿主的纯函数，这些模块里 `node:` 的导入由下面三处兑现：
 *
 *   node:crypto      Web Crypto 兑现的 `randomUUID` 与 `randomBytes`（nonce）。
 *   Buffer           状态额度用的 `Buffer.byteLength`。
 *   node:fs/promises 与 node:path 只被读写磁盘的函数用到，Service Worker 里没有这些函数的调用路径；
 *                    指到 node-disk.ts（每个函数都抛出），摇树之后产物里不留它们的任何一个（下面的构建检查盯着这一点）。
 */
async function buildWorker() {
  await esbuild.build({
    entryPoints: [path.join(DEMO, 'worker', 'index.ts')],
    outfile: path.join(OUT, 'sw.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    charset: 'utf8',
    logLevel: 'silent',
    alias: {
      'node:crypto': path.join(DEMO, 'worker', 'node-crypto.ts'),
      'node:fs/promises': path.join(DEMO, 'worker', 'node-disk.ts'),
      'node:path': path.join(DEMO, 'worker', 'node-disk.ts'),
    },
    inject: [path.join(DEMO, 'worker', 'node-buffer.ts')],
    // 未用到的导入按 TypeScript 的语义抹掉，读写磁盘的函数随摇树一起离开产物。
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: false } },
  })
  const code = fs.readFileSync(path.join(OUT, 'sw.js'), 'utf8')
  if (code.includes('演示宿主没有磁盘')) throw new Error('demo: Service Worker 的产物里还留着读写磁盘的调用路径（node-disk.ts 的函数进了产物）')
  return fs.statSync(path.join(OUT, 'sw.js')).size
}

/** 页面：插件的浏览器半边、外壳与文案。 */
async function buildPage() {
  await esbuild.build({
    entryPoints: [path.join(DEMO, 'page', 'main.tsx')],
    outfile: path.join(OUT, 'assets', 'page.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'esnext',
    minify: true,
    jsx: 'automatic',
    loader: { '.css': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })
  return fs.statSync(path.join(OUT, 'assets', 'page.js')).size
}

/** 构建时的数据：从源码打一个 Node 用的小包再运行它，复用宿主的组件库、工作区与文档拼装。 */
async function writeData() {
  const bundle = path.join(SCRATCH, 'seed.mjs')
  await esbuild.build({
    entryPoints: [path.join(DEMO, 'build', 'seed.ts')],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  })
  const { writeDemoData } = await import(`${pathToFileURL(bundle).href}?${Date.now()}`)
  return await writeDemoData({ lib: LIB, home: path.join(SCRATCH, 'home'), out: OUT })
}

console.log('demo: 先构建插件本身（scripts/build.mjs）')
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { stdio: 'inherit' })
typecheck('tsconfig.demo.json')
typecheck('tsconfig.demo-host.json')
fs.mkdirSync(OUT, { recursive: true })
for (const name of GENERATED) fs.rmSync(path.join(OUT, name), { recursive: true, force: true })
fs.mkdirSync(SCRATCH, { recursive: true })
const data = await writeData()
const worker = await buildWorker()
const page = await buildPage()
let html = fs.readFileSync(path.join(DEMO, 'page', 'index.html'), 'utf8')
if (RECORDING !== undefined) {
  fs.mkdirSync(path.join(OUT, 'media'), { recursive: true })
  fs.copyFileSync(RECORDING, path.join(OUT, 'media', path.basename(RECORDING)))
  html = html.replace('<meta name="demo-recording" content="">', `<meta name="demo-recording" content="media/${path.basename(RECORDING)}">`)
}
fs.writeFileSync(path.join(OUT, 'index.html'), html)
fs.copyFileSync(path.join(DEMO, 'page', 'page.css'), path.join(OUT, 'assets', 'page.css'))
fs.writeFileSync(path.join(OUT, '.nojekyll'), '')
console.log(`demo: ${OUT}\n  sw.js ${worker} 字节，assets/page.js ${page} 字节，${Object.keys(data.widgets).length} 个组件（${data.unsupported.length} 个需要宿主的组件没有放进来：${data.unsupported.map((entry) => entry.id).join('、')}），默认看板 ${data.snapshot.boards[0]?.instances.length ?? 0} 张卡`)
