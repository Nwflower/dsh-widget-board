#!/usr/bin/env node
/**
 * dsh-web.cjs — 一个装了本仓库的临时 dsh web 实例，以及它上面的一个浏览器页面。
 *
 * 本仓库的两个半边只有在装好的宿主里才成形：插槽、模块表与加载器的行为都不在源码树里。
 * 这个文件是那些检查的唯一入口：
 *
 *   start()     在 .debug/ 下建一个独立的 `$DSH_HOME`，把本仓库装进它的 web profile，
 *               起 `dsh --profile web --port 0 --no-open`，交回它在启动时打印的地址。地址里
 *               带启动令牌，裸 fetch 会被 401 拒掉，只有浏览器换得到会话。
 *   openPage()  用本机的 Chrome 或 Edge 打开那个地址，收集控制台里的错误与警告。
 *
 * 直接运行它会给手动核对留一个实例：打印地址，然后等到被中断。
 *
 * 用法：node packages/testing/dsh-web.cjs [--port <n>]
 */
'use strict'
const { spawn, spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { launchBrowser, newContextOn } = require('./browser.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
/** 临时宿主的 home：跟其他调试产物一起放在 .debug/ 下。 */
const DEFAULT_HOME = path.join(ROOT, '.debug', 'host')
/**
 * 一轮检查自己的临时 home：不跟并行跑的检查或手工调好的 `.debug/host` 抢同一个宿主。
 *
 * `.debug/` 被 gitignore，新检出（持续集成）里没有它，先建出来再在里面取临时目录。
 *
 * @param prefix - 目录名前缀，例如 `smoke-`。
 * @returns 新建的目录。
 */
function scratchHome(prefix) {
  const scratch = path.join(ROOT, '.debug')
  fs.mkdirSync(scratch, { recursive: true })
  return fs.mkdtempSync(path.join(scratch, prefix))
}

/** 预加载进宿主，让它在调用方退出时一起结束。 */
const LIFELINE = path.join(__dirname, 'lifeline.cjs')

/**
 * 给临时 home 一个它自己的 workspace。
 *
 * 空的 `$DSH_HOME` 里没有 workspace 注册表，外壳会先让人挑一个目录而不是直接起一桌。注册的目录
 * 建在 home 里面，机器上别处不受影响；已经有注册表的 home 保持原样。
 *
 * @param home - 临时 `$DSH_HOME`。
 */
function ensureWorkspace(home) {
  const storages = path.join(home, 'storages')
  const file = path.join(storages, 'workspace.json')
  if (fs.existsSync(file)) return
  const directory = path.join(home, 'workspace')
  fs.mkdirSync(directory, { recursive: true })
  fs.mkdirSync(storages, { recursive: true })
  const id = randomUUID()
  const now = new Date().toISOString()
  fs.writeFileSync(file, `${JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      workspaceIds: [id],
      archivedSessionIds: [],
      pinnedSessionIds: [],
      defaultWorkspaceId: id,
    },
    tables: {
      workspaces: {
        [id]: { path: directory, title: 'widget-board-scratch', sessionIds: [], createdAt: now, updatedAt: now },
      },
    },
  }, null, 2)}\n`)
}

/**
 * 把临时 home 交给当前账号，继承给写进去的一切。
 *
 * 宿主会给自己在 `$DSH_HOME` 里划出沙箱，那一步要当前账号对 home 有 WRITE_OWNER；新建目录只带
 * 继承来的 Modify，Windows 不因它推导出 WRITE_OWNER，宿主的授权就会失败。这台机器上的检查都
 * 归这个账号，所以让 home 成为宿主能直接布置的那种目录。
 *
 * @param home - 临时 `$DSH_HOME`。
 */
function provisionHome(home) {
  if (process.platform !== 'win32') return
  const { USERDOMAIN, USERNAME } = process.env
  if (!USERNAME) throw new Error(`看不出 ${home} 属于哪个账号：USERNAME 没有设置`)
  const account = USERDOMAIN ? `${USERDOMAIN}\\${USERNAME}` : USERNAME
  const granted = spawnSync('icacls', [home, '/grant:r', `${account}:(OI)(CI)F`], { stdio: 'pipe', encoding: 'utf8' })
  if (granted.status !== 0) throw new Error(`icacls 没能把 ${home} 交给 ${account}（退出码 ${granted.status}）：${granted.stderr.trim()}`)
}

/** 跑完一条命令行，输出照原样打出；非零退出抛错。 */
function run(command, env) {
  const result = spawnSync(command, { stdio: 'inherit', shell: true, env })
  if (result.status !== 0) throw new Error(`${command} 以 ${result.status} 退出`)
}

/**
 * 起一个装了本仓库的临时宿主。
 *
 * @param options.home - 临时 `$DSH_HOME`，默认 `.debug/host`。
 * @param options.profile - 要起的 profile，默认 `web`。
 * @param options.port - 端口；0 让系统挑一个。
 * @param options.extras - 一起装进这个 profile 的其他包目录，例如提供方 fixture。
 * @param options.timeoutMs - 等启动地址的上限。
 * @returns `{ url, home, stop }`；`stop` 连同它起的子进程一起收掉。
 */
async function start(options = {}) {
  const home = path.resolve(options.home ?? DEFAULT_HOME)
  const profile = options.profile ?? 'web'
  const port = options.port ?? 0
  const timeoutMs = options.timeoutMs ?? 180000
  fs.mkdirSync(home, { recursive: true })
  provisionHome(home)
  ensureWorkspace(home)
  // 幂等：第一次跑时装进来，之后 pnpm 报 "already up to date"。
  run(`dsh plugin --profile ${profile} add "${ROOT}"`, { ...process.env, DSH_HOME: home })
  for (const extra of options.extras ?? []) {
    run(`dsh plugin --profile ${profile} add "${extra}"`, { ...process.env, DSH_HOME: home })
  }
  const env = {
    ...process.env,
    DSH_HOME: home,
    DSH_WEB_LIFELINE: '1',
    // 反斜杠在引号里会被 NODE_OPTIONS 当成转义，路径统一用正斜杠。
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require "${LIFELINE.replaceAll('\\', '/')}"`].filter(Boolean).join(' '),
  }
  // 命令走 shell 时才认得出 PATH 里的 dsh，因此这里起的是一个 shell，sh 再执行 dsh。止住它的
  // 时候要连 dsh 一起止：Unix 上让子进程自带一个进程组，向整组发信号（只发给 sh，dsh 会留下来
  // 接着监听端口，调用方的输出管道也一直开着，进程退不掉）；Windows 上用 taskkill /T。
  const child = spawn(`dsh --profile ${profile} --port ${port} --no-open`, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    detached: process.platform !== 'win32',
  })
  const stop = () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      return
    }
    process.kill(-child.pid, 'SIGTERM')
  }
  /** 宿主进程到目前为止的输出：插件登记了什么、有没有报错都写在这里。 */
  let log = ''
  const url = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => {
      stop()
      reject(new Error(`宿主在 ${timeoutMs} 毫秒内没有打印地址；到那为止的输出：\n${output}`))
    }, timeoutMs)
    const watch = (chunk) => {
      output += chunk.toString()
      log = output
      const match = output.match(/dsh web: (http\S+)/)
      if (match === null) return
      clearTimeout(timer)
      resolve(match[1])
    }
    child.stdout.on('data', watch)
    child.stderr.on('data', watch)
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`宿主在打印地址之前以 ${code} 退出：\n${output}`))
    })
  })
  return { url, home, stop, log: () => log }
}

/**
 * 在临时宿主上开一个页面。
 *
 * @param url - `start()` 交回的地址。
 * @param options.headless - 不开窗口（默认开）。
 * @param options.width/height - 视口。
 * @param options.reducedMotion - `reduce` 时整页按减弱动效渲染。
 * @returns `{ page, problems, close }`；`problems` 收集控制台里的错误、警告与未捕获异常。
 */
async function openPage(url, options = {}) {
  const browser = await launchBrowser({ headless: options.headless ?? true })
  const context = await newContextOn(browser, {
    width: options.width ?? 1440,
    height: options.height ?? 900,
    ...(options.reducedMotion === undefined ? {} : { reducedMotion: options.reducedMotion }),
  })
  const page = await context.newPage()
  const problems = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  return { page, problems, close: () => browser.close() }
}

/**
 * `start()` 与 `openPage()` 一起用的包装：起宿主、开页面、结束时两样都收掉。
 *
 * @param body - 拿到 `{ page, problems, url }` 的异步函数。
 */
async function withHost(body) {
  const host = await start()
  let opened
  try {
    opened = await openPage(host.url)
    return await body({ page: opened.page, problems: opened.problems, url: host.url })
  } finally {
    if (opened !== undefined) await opened.close()
    host.stop()
  }
}

module.exports = { DEFAULT_HOME, openPage, scratchHome, start, withHost }

if (require.main === module) {
  const at = process.argv.indexOf('--port')
  start(at === -1 ? {} : { port: Number(process.argv[at + 1]) }).then((host) => {
    console.log(`dsh web: ${host.url}\nDSH_HOME: ${host.home}\n中断这个进程即可收掉实例。`)
    const fail = (error) => {
      console.error(error)
      host.stop()
      process.exitCode = 1
    }
    process.on('SIGINT', fail)
    process.on('SIGTERM', fail)
  }, (error) => {
    console.error(error)
    process.exitCode = 1
  })
}
