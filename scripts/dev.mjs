#!/usr/bin/env node
/**
 * dev.mjs — 构建读到的东西一改就重新构建。
 *
 * 每次重新构建都是新进程里跑一整遍 `node scripts/build.mjs`：构建在开始时读一次 package.json 与
 * 源码，一进程一次才保证改过的常量不会被读成旧的。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const BUILD = path.join(ROOT, 'scripts', 'build.mjs')

/** 构建读的东西：目录覆盖它底下的全部文件。 */
const WATCHED_DIRS = ['packages/contracts', 'packages/model', 'packages/host', 'packages/client', 'scripts']
const WATCHED_FILES = ['package.json', 'tsconfig.json', 'tsconfig.host.json']

/** 挨得这么近的改动算一次编辑：一次保存动了好几个文件也只构建一次。 */
const SETTLE_MS = 120

/**
 * 仓库内这个路径上的改动是不是构建的输入。
 *
 * @param file - 相对仓库根的路径。
 * @returns 是输入时为真。
 */
function isInput(file) {
  if (WATCHED_FILES.includes(file)) return true
  return WATCHED_DIRS.some((dir) => file.startsWith(`${dir}/`))
}

let running = false
let pending = null
let timer = 0

/** 重跑一整遍构建；跑着的时候来的改动排在它后面再跑一次。 */
function build(reason) {
  running = true
  const started = Date.now()
  console.log(`\n[dev] 构建（${reason}）`)
  const child = spawn(process.execPath, [BUILD], { cwd: ROOT, stdio: 'inherit' })
  child.on('close', (code) => {
    const took = Date.now() - started
    console.log(code === 0
      ? `[dev] ${took} 毫秒构建完成，继续监视`
      : `[dev] 构建在 ${took} 毫秒后失败（退出码 ${code}）；lib/ 保持上一次的内容，继续监视`)
    running = false
    if (pending !== null) {
      const next = pending
      pending = null
      build(next)
    }
  })
}

/** 记录一处改动，等在 SETTLE_MS 里没有新改动再构建。 */
function changed(file) {
  if (!isInput(file)) return
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (running) pending = file
    else build(file)
  }, SETTLE_MS)
}

const relative = (dir, name) => `${dir}/${name.split(path.sep).join('/')}`
for (const dir of WATCHED_DIRS) {
  fs.watch(path.join(ROOT, dir), { recursive: true }, (_event, name) => {
    if (name !== null) changed(relative(dir, name))
  })
}
fs.watch(ROOT, (_event, name) => {
  if (name !== null && WATCHED_FILES.includes(name)) changed(name)
})

console.log(`[dev] 监视 ${[...WATCHED_DIRS.map((dir) => `${dir}/`), ...WATCHED_FILES].join('、')}`)
build('启动')
