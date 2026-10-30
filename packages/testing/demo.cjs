#!/usr/bin/env node
/**
 * demo.cjs — 演示页的验收：把 `npm run demo` 的产物放在静态服务器的子路径下，在浏览器里走一遍。
 *
 * 子路径与目录重定向模仿 GitHub Pages 上的项目站点：页面不在域名根上，请求 `…/document` 的路径
 * 要被重定向到 `…/document/`。检查的是演示页的判据：真实的看板出现、卡片接上握手、拖动与缩放写进
 * 演示宿主、翻面组能加能翻、浅色深色与语言切换、刷新后布局保留、演示宿主不提供的能力有可见的说法、
 * 窄屏没有横向滚动、控制台没有错误；截图写进 `.debug/demo-shots/`（D25）。
 *
 * 用法：node packages/testing/demo.cjs [<演示页目录>]    缺省是 .debug/demo
 */
'use strict'
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { launchBrowser, newContextOn } = require('./browser.cjs')
const { cardBox, frameOf } = require('./frames.cjs')
const { columnStep, layoutOf, settled, waitLayout } = require('./geometry.cjs')
const { groupPass } = require('./group.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const SITE = path.resolve(process.argv[2] ?? path.join(ROOT, '.debug', 'demo'))
const SHOTS = path.join(ROOT, '.debug', 'demo-shots')
/** 子路径：与 GitHub Pages 的项目站点同形。 */
const BASE = '/dsh-widget-board/'

const GRIP = '[data-dsh-widget-board-handle="move"]'
const RESIZE = '[data-dsh-widget-board-handle="resize"]'
const VIEW = '[data-dsh-widget-board-view]'
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 每条判据的结果，最后按没过的条数定退出码。 */
const verdicts = []

/** 记一条判据。 */
function check(label, ok, detail) {
  verdicts.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  (${detail})`}`)
}

/**
 * 一个最小的静态服务器：子路径、目录重定向、按扩展名给类型，行为与静态托管一致。
 *
 * @returns 已经在监听的服务器。
 */
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost')
      if (!url.pathname.startsWith(BASE)) {
        response.writeHead(404).end()
        return
      }
      let file = path.join(SITE, decodeURIComponent(url.pathname.slice(BASE.length)))
      if (!file.startsWith(SITE) || !fs.existsSync(file)) {
        response.writeHead(404).end()
        return
      }
      if (fs.statSync(file).isDirectory()) {
        if (!url.pathname.endsWith('/')) {
          response.writeHead(301, { location: `${url.pathname}/${url.search}` }).end()
          return
        }
        file = path.join(file, 'index.html')
        if (!fs.existsSync(file)) {
          response.writeHead(404).end()
          return
        }
      }
      response.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
      fs.createReadStream(file).pipe(response)
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

/** 一张卡的实例 id，按 iframe 标题找。 */
async function instanceOf(page, title) {
  return page.evaluate((name) => document.querySelector(`iframe.dsh-widget-board__frame[title="${name}"]`)?.closest('[data-instance]')?.getAttribute('data-instance') ?? '', title)
}

/** 把演示页打开到看板出现。 */
async function open(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(VIEW, { timeout: 30000 })
  await settled(page, 15000)
}

/** 拖动与缩放：松手写进演示宿主，刷新之后还在。 */
async function layoutPass(page, url) {
  const id = await instanceOf(page, '番茄钟')
  check('看板上有番茄钟卡', id !== '')
  await page.evaluate((name) => document.querySelector(`iframe.dsh-widget-board__frame[title="${name}"]`)?.scrollIntoView({ block: 'center' }), '番茄钟')
  await sleep(400)
  const step = await columnStep(page)
  const before = await layoutOf(page, id)
  const card = page.locator(`[data-instance="${id}"]`)
  const grip = card.locator(GRIP)
  await grip.hover()
  const gripBox = await grip.boundingBox()
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(gripBox.x + gripBox.width / 2 + step * 1.1, gripBox.y + gripBox.height / 2 + 90, { steps: 12 })
  await sleep(300)
  await page.mouse.up()
  const moved = await waitLayout(page, id, (layout) => layout.x !== before.x || layout.y !== before.y)
  check('拖动改写卡片的列与纵向位置', moved.x !== before.x || moved.y !== before.y, `${JSON.stringify(before)} → ${JSON.stringify(moved)}`)

  const resize = card.locator(RESIZE)
  await resize.hover()
  const resizeBox = await resize.boundingBox()
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + step, resizeBox.y + resizeBox.height / 2 + 70, { steps: 12 })
  await sleep(300)
  await page.mouse.up()
  const resized = await waitLayout(page, id, (layout) => layout.w !== moved.w || layout.h !== moved.h)
  check('缩放改写卡片的跨列与高度', resized.w !== moved.w || resized.h !== moved.h, `${JSON.stringify(moved)} → ${JSON.stringify(resized)}`)
  const box = await cardBox(page, '番茄钟')
  check('组件跟着新盒子排版', Math.abs(box.frameHeight - box.height) <= 1, `${box.width}×${box.height}`)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(VIEW, { timeout: 30000 })
  await settled(page)
  const kept = await layoutOf(page, id)
  check('刷新之后布局还在', kept?.x === resized.x && kept?.y === resized.y && kept?.w === resized.w && kept?.h === resized.h, JSON.stringify(kept))
}

/** 浅色与深色：页面与每张卡片一起换。 */
async function themePass(page) {
  const toggle = page.locator('[data-demo-theme]')
  const heroFrame = await frameOf(page, 'iframe.dsh-widget-board__frame[title="看板题头"]')
  const read = async () => ({
    dark: await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme')),
    card: await heroFrame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--w-color-bg').trim()),
  })
  const first = await read()
  await toggle.click()
  await page.waitForFunction((was) => document.body.hasAttribute('data-ds-dark-theme') !== was, first.dark, { timeout: 5000 })
  await sleep(600)
  const second = await read()
  check('切换浅色深色：页面换色', second.dark !== first.dark)
  check('切换浅色深色：卡片里的令牌跟着换', second.card !== first.card, `${first.card} → ${second.card}`)
  // 拖动与缩放之后看板滚到了别处：截图前回到顶部。
  await page.evaluate(() => {
    window.scrollTo(0, 0)
    document.querySelector('.dsh-widget-board')?.scrollTo(0, 0)
  })
  await sleep(500)
  await page.screenshot({ path: path.join(SHOTS, `theme-${second.dark ? 'dark' : 'light'}.png`) })
  await toggle.click()
  await sleep(400)
}

/** 语言：页面文案与看板里每张卡的文档语言一起换。 */
async function languagePass(page) {
  await page.getByRole('button', { name: 'English' }).click()
  await page.waitForFunction(() => /^Inside DSH/.test(document.querySelector('h2')?.textContent ?? ''), undefined, { timeout: 15000 })
  const hero = await frameOf(page, 'iframe.dsh-widget-board__frame[title="看板题头"]')
  await hero.waitForFunction(() => document.documentElement.lang === 'en', undefined, { timeout: 10000 })
  check('切到英文：页面文案与卡片文档都是英文', true)
  await page.screenshot({ path: path.join(SHOTS, 'desktop-board-en.png') })
  await page.getByRole('button', { name: '中文' }).click()
  await page.waitForFunction(() => document.querySelector('h2')?.textContent?.startsWith('在 DSH'), undefined, { timeout: 15000 })
  await frameOf(page, 'iframe.dsh-widget-board__frame[title="看板题头"]')
}

/** 演示宿主不提供的能力：拒绝里写明原因，数据不伪造。 */
async function unsupportedPass(page, errors) {
  const id = await instanceOf(page, '番茄钟')
  const supported = await page.evaluate(async cardId => {
    const log = await fetch(`api/widget-board/instance/${cardId}/log`)
    const visibility = await fetch('api/widget-board/visibility', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ viewer: 'demo-check', visible: [cardId] }),
    })
    return { log: { status: log.status, body: await log.json() }, visibility: { status: visibility.status, body: await visibility.json() } }
  }, id)
  check('已有卡片返回空请求日志及条数上限', supported.log.status === 200 && Array.isArray(supported.log.body.entries) && supported.log.body.entries.length === 0 && supported.log.body.limit > 0, JSON.stringify(supported.log))
  check('演示页校验可见性上报但不启动数据调度', supported.visibility.status === 200 && supported.visibility.body.ok === true && supported.visibility.body.accepted === false, JSON.stringify(supported.visibility))
  // 以下探针故意发出会被拒绝的请求；它们的控制台错误在断言后清除。
  const expected = errors.length
  const refused = await page.evaluate(async () => {
    const log = await fetch('api/widget-board/instance/demo-missing/log')
    const visibility = await fetch('api/widget-board/visibility', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ viewer: '', visible: [] }),
    })
    return { log: log.status, visibility: visibility.status }
  })
  check('未知卡片的请求日志仍返回 404', refused.log === 404, String(refused.log))
  check('不合规的可见性上报返回 400', refused.visibility === 400, String(refused.visibility))
  const read = await page.evaluate(async (cardId) => {
    const response = await fetch(`api/widget-board/instance/${cardId}/read`, { method: 'POST' })
    return { status: response.status, body: await response.json() }
  }, id)
  check('数据源在演示宿主上回一条写明原因的拒绝', read.status === 501 && /只读/.test(read.body.error), JSON.stringify(read))
  const stale = await page.evaluate(async () => {
    const workspace = await (await fetch('api/widget-board/boards')).json()
    const board = workspace.boards[0]
    const response = await fetch(`api/widget-board/boards/${board.id}/layout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layoutRevision: board.layoutRevision + 5, layouts: {} }),
    })
    return response.status
  })
  check('过期的布局修订号是 409', stale === 409, String(stale))
  await sleep(400)
  errors.length = expected
}

/** 恢复默认看板：清掉存下来的布局。 */
async function resetPass(page) {
  const id = await instanceOf(page, '番茄钟')
  const edited = await layoutOf(page, id)
  await page.getByRole('button', { name: '恢复默认看板' }).click()
  await page.waitForSelector(VIEW, { timeout: 30000 })
  await settled(page)
  const fresh = await layoutOf(page, await instanceOf(page, '番茄钟'))
  check('恢复默认看板之后布局回到默认', fresh !== undefined && (fresh.x !== edited.x || fresh.y !== edited.y || fresh.w !== edited.w || fresh.h !== edited.h), JSON.stringify(fresh))
}

/** 窄屏：一列，没有横向滚动。 */
async function narrowPass(browser, url, errors) {
  const context = await newContextOn(browser, { width: 375, height: 812 })
  const page = await context.newPage()
  watch(page, errors)
  await open(page, url)
  const columns = await page.evaluate(() => Number(document.querySelector('[data-dsh-widget-board-view]')?.getAttribute('data-dsh-widget-board-columns') ?? 0))
  check('375px 宽时看板是一列', columns === 1, String(columns))
  const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  check('375px 宽时页面没有横向滚动', overflow.scroll <= overflow.client, JSON.stringify(overflow))
  await page.screenshot({ path: path.join(SHOTS, 'mobile-board.png') })
  await page.screenshot({ path: path.join(SHOTS, 'mobile-full.png'), fullPage: true })
  const full = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  check('375px 宽时整页没有横向滚动', full.scroll <= full.client, JSON.stringify(full))
  await context.close()
}

/** 收集页面自己的错误：脚本异常与控制台错误。 */
function watch(page, errors) {
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
  // 卸载文档、关闭 EventSource 与整页刷新会中止在途的请求，那是正常的收尾；其余失败都算错误。
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`requestfailed: ${request.url()}`)
  })
}

async function main() {
  if (!fs.existsSync(path.join(SITE, 'index.html'))) throw new Error(`${SITE} 里没有 index.html，先运行 npm run demo`)
  fs.mkdirSync(SHOTS, { recursive: true })
  const server = await serve()
  const url = `http://127.0.0.1:${server.address().port}${BASE}`
  const browser = await launchBrowser()
  const errors = []
  try {
    const context = await newContextOn(browser)
    const page = await context.newPage()
    watch(page, errors)
    await open(page, url)
    const cards = await page.evaluate(() => document.querySelectorAll('[data-instance]').length)
    // 默认看板：七张单卡加一组日历组，组卡在页面上是一个盒子。
    check('真实的看板出现，卡片都在', cards >= 8, `${cards} 张`)
    await frameOf(page, 'iframe.dsh-widget-board__frame[title="看板题头"]')
    check('卡片的沙箱文档接上了握手', true)
    const sandbox = await page.evaluate(() => Array.from(document.querySelectorAll('iframe.dsh-widget-board__frame')).every((frame) => frame.getAttribute('sandbox') === 'allow-scripts'))
    check('每张卡片都是 sandbox="allow-scripts" 的 iframe', sandbox)
    const policy = await page.evaluate(async () => {
      const frame = document.querySelector('iframe.dsh-widget-board__frame')
      const html = await (await fetch(frame.getAttribute('src'))).text()
      return /http-equiv="content-security-policy" content="default-src 'none'; script-src 'nonce-[^']+'/.test(html)
    })
    check('组件文档带真实宿主的 CSP', policy)
    await page.screenshot({ path: path.join(SHOTS, 'desktop-board.png') })

    await layoutPass(page, url)
    await groupPass(page, check)
    await themePass(page)
    await languagePass(page)
    await unsupportedPass(page, errors)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: path.join(SHOTS, 'desktop-full.png'), fullPage: true })
    await resetPass(page)
    await context.close()
    await narrowPass(browser, url, errors)
  } finally {
    await browser.close()
    server.close()
  }
  check('控制台没有错误', errors.length === 0, errors.slice(0, 3).join(' | '))
  const failed = verdicts.filter((ok) => !ok).length
  console.log(failed === 0 ? '\n演示页验收通过' : `\n演示页验收有 ${failed} 项没过`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
