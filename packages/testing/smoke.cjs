#!/usr/bin/env node
/**
 * smoke.cjs — 在真实的临时宿主上走一遍插件自己的表面。
 *
 * 检查的是本插件的判据，不看宿主的实现：侧栏出现入口、点开是一页卡片栅格、卡片各自加载
 * 出来、天气卡切预报日与番茄钟开合计时都真的动、三个动效模板能翻转与跟随指针、拖动与缩放会改写
 * 卡片盒子并保存到宿主、窄窗口里列数降到一列、减弱动效下天空静置、控制台没有错误。查找只用插件
 * 自己写在节点上的标记
 * （`svg.dsh-widget-board__icon`、`data-dsh-widget-board-*`、卡片的 iframe `title`），宿主换了
 * 内部结构也不会让这些判据失真（D1）。
 *
 * 用法：node packages/testing/smoke.cjs
 */
'use strict'
const { readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { openPage, start } = require('./dsh-web.cjs')
const { cardBox, centerCard, frameOf } = require('./frames.cjs')
const { resetCards, resetLayout, setCardHeight } = require('./board.cjs')
const { dockPass } = require('./dock.cjs')
const { openLibrary } = require('./library.cjs')
const { groupPass } = require('./group.cjs')
const { markdownPass } = require('./markdown.cjs')
const { noticePass } = require('./notice.cjs')
const { openBoard } = require('./panel.cjs')
const { tabsPass } = require('./tabs.cjs')
const { providerPass } = require('./provider.cjs')

/** 插件自己画的东西，只用这些标记找节点。 */
const PANEL_ICON = 'svg.dsh-widget-board__icon'
const BOARD_VIEW = '[data-dsh-widget-board-view]'
const HERO_FRAME = 'iframe.dsh-widget-board__frame[title="看板题头"]'
const MEASURE = '[data-dsh-widget-board-measure]'
const GHOST = '[data-dsh-widget-board-ghost]'
const FLOW = '.dsh-widget-board__flow'
const CARD_FRAME = 'iframe.dsh-widget-board__frame'
const GRIP = '[data-dsh-widget-board-handle="move"]'
const RESIZE = '[data-dsh-widget-board-handle="resize"]'
const SHEET = 'style[data-plugin="dsh-widget-board"]'
/** 两张内置卡片的 iframe 标题，来自 manifest 的中文标题。 */
const WEATHER_FRAME = 'iframe.dsh-widget-board__frame[title="天气"]'
const POMODORO_FRAME = 'iframe.dsh-widget-board__frame[title="番茄钟"]'
const TODO_FRAME = 'iframe.dsh-widget-board__frame[title="待办"]'
const FLIP_FRAME = 'iframe.dsh-widget-board__frame[title="翻转卡"]'
const MAGNETIC_FRAME = 'iframe.dsh-widget-board__frame[title="磁吸卡"]'
const HOLO_FRAME = 'iframe.dsh-widget-board__frame[title="全息卡"]'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let failures = 0

/** 记一条判据。 */
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  (${detail})`}`)
  if (!ok) failures += 1
}

/**
 * 三个动效模板不自动铺到已有看板上（D17）：缺哪一张就从下方菜单打开组件库加哪一张。
 *
 * @param page - 宿主页面，看板已经打开。
 */
async function ensureTemplates(page) {
  const wanted = [['flip-card', '翻转卡'], ['magnetic-card', '磁吸卡'], ['holographic-card', '全息卡']]
  for (const [id, title] of wanted) {
    const present = await page.evaluate((title) => Array.from(document.querySelectorAll('iframe.dsh-widget-board__frame')).some((frame) => frame.title === title), title)
    if (present) continue
    const before = await page.evaluate(() => document.querySelectorAll('[data-instance]').length)
    await openLibrary(page)
    await page.waitForSelector(`[data-dsh-widget-board-add="${id}"]`, { timeout: 10000 })
    await page.locator(`[data-dsh-widget-board-add="${id}"]`).click()
    await page.waitForFunction((count) => document.querySelectorAll('[data-instance]').length === count + 1, before, { timeout: 10000 })
    await page.waitForSelector(`iframe.dsh-widget-board__frame[title="${title}"]`, { timeout: 30000 })
  }
}

/**
 * 等看板的几何稳定下来：卡片的高度刚上报时位置还在移位，点击会打在正在移动的节点上。
 *
 * @param page - 宿主页面。
 */
async function settled(page) {
  await page.waitForFunction(() => {
    const key = Array.from(document.querySelectorAll('[data-instance]')).map((node) => {
      const rect = node.getBoundingClientRect()
      return `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`
    }).join('|')
    const seen = window.__smokeGeometry
    window.__smokeGeometry = key
    return seen !== undefined && seen === key
  }, undefined, { timeout: 10000, polling: 300 })
}

/**
 * 读卡片上的剩余时间：翻页的数字由四个格子组成，每格上下两半写着同一个数字，只取上半。
 *
 * @param frame - 番茄钟的 frame。
 * @returns `mm:ss`。
 */
async function timeOf(frame) {
  const digits = await frame.evaluate(() => Array.from(document.querySelectorAll('#pomo-time .t-flip'))
    .map((cell) => cell.querySelector(':scope > .t-flip-half[data-half="top"]')?.textContent ?? ''))
  return `${digits.slice(0, 2).join('')}:${digits.slice(2).join('')}`
}

/**
 * 主路径：入口、卡片栅格、天气卡切预报日、番茄钟开合。
 *
 * @param page - 宿主页面。
 * @param problems - 打开页面以来控制台里的错误、警告与未捕获异常。
 */
async function mainPass(page, problems) {
  await page.waitForSelector(PANEL_ICON, { timeout: 120000 })
  check('侧栏出现看板入口', true)
  check('插件的样式表挂上了文档', await page.evaluate((selector) => document.querySelector(selector) !== null, SHEET))
  await resetCards(page)
  await openBoard(page)
  await ensureTemplates(page)
  await resetLayout(page)
  check('中栏打开一页看板', await page.evaluate((selector) => document.querySelector(selector) !== null, BOARD_VIEW))
  check('题头是一张卡片', await page.evaluate((selector) => document.querySelector(selector) !== null, HERO_FRAME))

  const columns = await page.evaluate(() => Number(document.querySelector('[data-dsh-widget-board-view]')?.getAttribute('data-dsh-widget-board-columns') ?? 0))
  check('看板按容器宽度分列', columns >= 1, `${columns} 列`)

  const weatherBox = await cardBox(page, '天气')
  check('卡片大小由布局给出', weatherBox.height > 300, `天气 ${weatherBox.width}×${weatherBox.height}`)
  check('组件填满卡片', Math.abs(weatherBox.frameWidth - weatherBox.width) <= 1 && Math.abs(weatherBox.frameHeight - weatherBox.height) <= 1, `iframe ${weatherBox.frameWidth}×${weatherBox.frameHeight}`)
  await settled(page)

  const boxes = await page.evaluate(() => Array.from(document.querySelectorAll('[data-instance]')).map((node) => {
    const rect = node.getBoundingClientRect()
    return { id: node.getAttribute('data-instance'), width: Math.round(rect.width), height: Math.round(rect.height), left: Math.round(rect.left), top: Math.round(rect.top) }
  }))
  check('内置卡片都在看板上', boxes.length >= 6, `${boxes.length} 张 · ${boxes.map((box) => `${box.width}×${box.height}`).join(' / ')}`)
  const overlap = boxes.some((one, index) => boxes.some((other, otherIndex) => otherIndex > index &&
    one.left < other.left + other.width && other.left < one.left + one.width &&
    one.top < other.top + other.height && other.top < one.top + one.height))
  check('卡片不互相压住', !overlap)

  const weather = await frameOf(page, WEATHER_FRAME)
  check('卡片文档按哈希取到', weather.url().includes('/widget/'), weather.url().replace(/^.*\/api/, '/api').slice(0, 52))
  check('天气卡画出来了', await weather.evaluate(() => document.querySelector('.wx') !== null))
  check('五个预报日', (await weather.evaluate(() => document.querySelectorAll('.t-tab').length)) === 5)
  // 卡片里的文案来自 manifest 的 text，只有握手接上才拿得到；拿不到时组件会退回键名。
  check('天气卡的地点由数据填上', (await weather.evaluate(() => document.querySelector('#wx-place')?.textContent)) === '旧金山')

  const day = await weather.evaluate(() => document.querySelector('#wx-day')?.textContent ?? '')
  await weather.locator('#wx-tab-3').click()
  await weather.waitForFunction(() => document.querySelector('.wx-bg')?.getAttribute('data-wx') === 'storm', undefined, { timeout: 5000 })
  await sleep(400)
  const after = await weather.evaluate(() => ({
    sky: document.querySelector('.wx-bg')?.getAttribute('data-wx'),
    day: document.querySelector('#wx-day')?.textContent,
    temp: document.querySelector('#wx-temp')?.textContent,
    digits: document.querySelectorAll('#wx-temp .t-digit').length,
    icon: document.querySelector('.wx-big .t-icon[data-key="bolt"]')?.hasAttribute('data-active'),
  }))
  check('天空切到雷雨', after.sky === 'storm')
  check('预报日跟着变', after.day !== day && after.day !== '', `${day} → ${after.day}`)
  check('温度换成新的数字', after.temp === '15', after.temp)
  check('数字走逐位动画', after.digits === 2)
  check('图标换到闪电', after.icon === true)

  const pomodoro = await frameOf(page, POMODORO_FRAME)
  check('番茄钟画出来了', await pomodoro.evaluate(() => document.querySelector('.pomo') !== null))
  const box = await pomodoro.evaluate(() => ({
    width: document.documentElement.dataset.boxWidth,
    height: document.documentElement.dataset.boxHeight,
    space: getComputedStyle(document.documentElement).getPropertyValue('--w-space-md').trim(),
  }))
  check('组件拿到盒子档位与间距令牌', box.width === 'regular' && box.height === 'regular' && box.space !== '', JSON.stringify(box))
  const shape = await pomodoro.evaluate(() => ({
    ticks: document.querySelectorAll('.pomo-tick').length,
    min: document.querySelector('#pomo-range')?.getAttribute('min'),
    max: document.querySelector('#pomo-range')?.getAttribute('max'),
  }))
  check('刻度按 5 到 60 分钟铺满一滑动条', shape.ticks === 56 && shape.min === '5' && shape.max === '60', `${shape.min}–${shape.max} / ${shape.ticks} 格`)
  const labels = await pomodoro.evaluate(() => ({
    title: document.querySelector('#pomo-title')?.textContent,
    caption: document.querySelector('#pomo-cap')?.textContent,
    presets: Array.from(document.querySelectorAll('.pomo-preset')).map((button) => button.textContent),
  }))
  check('番茄钟的文案接上了', labels.title === '专注时间' && labels.caption === '选一段专注时长', `${labels.title} / ${labels.caption}`)
  check('开始按钮上方是两个快捷时长', labels.presets.length === 2 && labels.presets[0] === '5分钟' && labels.presets[1] === '25分钟', labels.presets.join(' / '))

  // 矮盒子里的刻度不收起：14rem 高的卡片仍然画进度条，读数与按钮各就各位。
  const pomodoroId = await page.evaluate(() => document.querySelector('iframe.dsh-widget-board__frame[title="番茄钟"]')?.closest('[data-instance]')?.getAttribute('data-instance') ?? '')
  await setCardHeight(page, pomodoroId, 14)
  await sleep(600)
  const compact = await pomodoro.evaluate(() => {
    const slider = document.querySelector('#pomo-slider')
    const rect = slider?.getBoundingClientRect()
    return { shown: slider !== null && getComputedStyle(slider).display !== 'none' && rect.height > 0, ticks: document.querySelectorAll('.pomo-tick.is-on').length }
  })
  check('矮卡片里进度条还在', compact.shown && compact.ticks > 0, JSON.stringify(compact))
  await setCardHeight(page, pomodoroId, 22)
  await sleep(600)

  // 快捷时长点一下就换数字并开始；跑着的时候这一排收起来，不能拿来重新计时。
  await centerCard(page, '番茄钟')
  await pomodoro.locator('.pomo-preset[data-minutes="5"]').click()
  await sleep(700)
  const quickFive = await pomodoro.evaluate(() => ({
    pressed: document.querySelector('#pomo-start')?.getAttribute('aria-pressed'),
    active: document.querySelector('.pomo-preset[data-minutes="5"]')?.dataset.active,
    value: document.querySelector('#pomo-range')?.value,
    presets: getComputedStyle(document.querySelector('#pomo-presets')).display,
  }))
  check('按 5 分钟直接开始倒计时', (await timeOf(pomodoro)) === '05:00' && quickFive.pressed === 'true' && quickFive.active === 'true' && quickFive.value === '5', JSON.stringify(quickFive))
  check('运行中收起快捷时长', quickFive.presets === 'none', quickFive.presets)
  await pomodoro.locator('#pomo-start').click()
  await sleep(300)

  await pomodoro.locator('.pomo-preset[data-minutes="25"]').click()
  await sleep(700)
  const quickTwentyFive = await pomodoro.evaluate(() => ({
    pressed: document.querySelector('#pomo-start')?.getAttribute('aria-pressed'),
    active: document.querySelector('.pomo-preset[data-minutes="25"]')?.dataset.active,
    value: document.querySelector('#pomo-range')?.value,
  }))
  check('按 25 分钟直接开始倒计时', (await timeOf(pomodoro)) === '25:00' && quickTwentyFive.pressed === 'true' && quickTwentyFive.active === 'true' && quickTwentyFive.value === '25', JSON.stringify(quickTwentyFive))
  await pomodoro.locator('#pomo-start').click()
  await sleep(300)

  await pomodoro.evaluate(() => {
    const range = document.querySelector('#pomo-range')
    range.value = '40'
    range.dispatchEvent(new Event('input', { bubbles: true }))
  })
  // 翻页半秒之内落定，等它停稳再读。
  await sleep(600)
  check('拖动滑动条换数字', (await timeOf(pomodoro)) === '40:00')
  await centerCard(page, '番茄钟')
  await pomodoro.locator('#pomo-start').click()
  await sleep(200)
  const running = await pomodoro.evaluate(() => ({
    pressed: document.querySelector('#pomo-start')?.getAttribute('aria-pressed'),
    label: document.querySelector('#pomo-start-label')?.textContent,
    disabled: document.querySelector('#pomo-range')?.disabled,
  }))
  check('开始时按钮换成结束', running.pressed === 'true' && running.label === '结束这一段', running.label)
  check('运行中不能再改时长', running.disabled === true)

  // 秒数每秒走一格，走的那一格用翻页换：等一页翻动的半页出现，再看它停在整秒上。
  const flipped = await pomodoro.waitForFunction(() => document.querySelectorAll('#pomo-time .t-flip-page').length > 0, undefined, { timeout: 4000 })
    .then(() => true, () => false)
  check('数字按翻页换', flipped)
  await sleep(1500)
  const pages = await pomodoro.evaluate(() => document.querySelectorAll('#pomo-time .t-flip-page').length)
  const shown = await timeOf(pomodoro)
  check('秒数在走', pages === 0 && /^39:5\d$|^40:00$/.test(shown), shown)

  // 卡片重挂、整页重载之后计时接着跑：会话存在宿主上，不随页面丢失（D5）。
  const stored = await page.evaluate(async (id) => {
    const workspace = await (await fetch('api/widget-board/boards')).json()
    const board = workspace.boards.find((entry) => entry.id === workspace.active) ?? workspace.boards[0]
    return board.instances.find((instance) => instance.id === id)?.state ?? null
  }, pomodoroId)
  check('宿主存下了结束时刻', typeof stored?.endsAt === 'number' && stored.endsAt > Date.now(), JSON.stringify(stored))

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(PANEL_ICON, { timeout: 120000 })
  await openBoard(page)
  await settled(page)
  const resumed = await frameOf(page, POMODORO_FRAME)
  await sleep(900)
  const back = await resumed.evaluate(() => ({
    pressed: document.querySelector('#pomo-start')?.getAttribute('aria-pressed'),
    caption: document.querySelector('#pomo-cap')?.textContent,
    disabled: document.querySelector('#pomo-range')?.disabled,
  }))
  const resumedTime = await timeOf(resumed)
  check('重载之后计时还在跑', back.pressed === 'true' && back.disabled === true, `${back.pressed} / ${back.caption}`)
  check('剩下的时长还在', /^39:\d\d$|^40:00$/.test(resumedTime), resumedTime)

  await centerCard(page, '番茄钟')
  await resumed.locator('#pomo-start').click()
  await resumed.waitForFunction(
    () => document.querySelector('#pomo-start')?.getAttribute('aria-pressed') === 'false',
    undefined,
    { timeout: 4000 },
  ).catch(() => {})
  check('结束之后回到未运行', (await resumed.evaluate(() => document.querySelector('#pomo-start')?.getAttribute('aria-pressed'))) === 'false')

  // 待办卡片：回车加一条、勾掉它（状态存在宿主上，D5）。
  const todo = await frameOf(page, TODO_FRAME)
  check('待办卡画出来了', await todo.evaluate(() => document.querySelector('.todo') !== null))
  await todo.locator('#todo-input').fill('写第二张卡片')
  await todo.locator('#todo-input').press('Enter')
  await sleep(400)
  const added = await todo.evaluate(() => ({
    rows: document.querySelectorAll('.todo-row').length,
    count: document.querySelector('#todo-count')?.textContent,
    text: document.querySelector('.todo-text')?.textContent,
  }))
  check('回车加一条', added.rows === 1 && added.text === '写第二张卡片' && added.count === '0 / 1', `${added.rows} 条 / ${added.count}`)
  await todo.locator('.todo-row .todo-check').first().click()
  await sleep(300)
  const ticked = await todo.evaluate(() => ({
    done: document.querySelectorAll('.todo-row[data-done="true"]').length,
    count: document.querySelector('#todo-count')?.textContent,
    progress: document.querySelector('#todo-progress')?.style.transform,
  }))
  check('勾掉一条', ticked.done === 1 && ticked.count === '1 / 1' && ticked.progress === 'scaleX(1)', `${ticked.count} / ${ticked.progress}`)

  // 整页重载之后清单与勾选都还在：条目走的是宿主上的状态（D5）。
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(PANEL_ICON, { timeout: 120000 })
  await openBoard(page)
  const todoAgain = await frameOf(page, TODO_FRAME)
  await sleep(600)
  const kept = await todoAgain.evaluate(() => ({
    rows: document.querySelectorAll('.todo-row').length,
    done: document.querySelectorAll('.todo-row[data-done="true"]').length,
    text: document.querySelector('.todo-text')?.textContent,
  }))
  check('重载之后待办还在', kept.rows === 1 && kept.done === 1 && kept.text === '写第二张卡片', `${kept.rows} 条 / ${kept.done} 条已完成`)
  await todoAgain.locator('.todo-row .todo-remove').first().click()
  await sleep(300)
  check('删掉这一条', (await todoAgain.evaluate(() => document.querySelectorAll('.todo-row').length)) === 0)

  const live = await page.evaluate(async () => {
    const response = await fetch('api/widget-board/events', { headers: { accept: 'text/event-stream' } })
    const reader = response.body.getReader()
    const { value } = await reader.read()
    await reader.cancel()
    return { status: response.status, first: new TextDecoder().decode(value ?? new Uint8Array()).trim() }
  })
  check('变更通知接得上，先补一条重取快照', live.status === 200 && /^data: \{"revision":\d+,"event":\{"type":"board"\}\}$/.test(live.first), live.first)

  const errors = problems.filter((problem) => problem.startsWith('error:') || problem.startsWith('pageerror:'))
  check('控制台没有错误', errors.length === 0, errors.join(' / '))
  const warnings = problems.filter((problem) => problem.startsWith('warning:'))
  if (warnings.length > 0) console.log(`      控制台里有 ${warnings.length} 条警告：${warnings.join(' / ')}`)
}

/**
 * 添加与移除（D17）：下方菜单的添加动作打开组件库，点一个组件多一张卡，再把它移掉。
 *
 * @param page - 宿主页面，看板已经打开。
 */
async function addRemovePass(page) {
  const before = await page.evaluate(() => document.querySelectorAll('[data-instance]').length)
  await openLibrary(page)
  const listed = await page.evaluate(() => document.querySelectorAll('[data-dsh-widget-board-add]').length)
  check('组件库列出全部组件', listed >= 3, `${listed} 个`)
  const generic = await page.evaluate((ids) => ids.every((id) => document.querySelector(`[data-dsh-widget-board-add="${id}"]`) !== null), ['stat', 'list', 'table', 'chart', 'progress', 'kv', 'timeline', 'image'])
  check('八个通用数据组件都在组件库里', generic)
  const preview = await frameOf(page, '.dsh-widget-board__library-preview iframe.dsh-widget-board__frame[title="番茄钟"]')
  const previewState = await preview.evaluate(() => ({
    size: document.documentElement.dataset.size,
    placement: document.documentElement.dataset.placement,
    presets: getComputedStyle(document.querySelector('.pomo-presets')).display,
    start: getComputedStyle(document.querySelector('.pomo-start')).display,
  }))
  check('缩略画面标明 preview 并收掉按钮', previewState.size === 'preview' && previewState.placement === 'preview' && previewState.presets === 'none' && previewState.start === 'none', JSON.stringify(previewState))
  await page.locator('[data-dsh-widget-board-add="weather"]').click()
  await page.waitForFunction((count) => document.querySelectorAll('[data-instance]').length === count + 1, before, { timeout: 10000 })
  check('从组件库加了一张卡', true)
  const added = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('[data-instance]'))
    return cells.at(-1)?.getAttribute('data-instance') ?? ''
  })
  await page.locator(`[data-instance="${added}"] [data-dsh-widget-board-handle="remove"]`).click()
  const exit = await page.evaluate((instance) => {
    const cell = document.querySelector(`[data-instance="${instance}"]`)
    if (cell === null) return null
    const style = getComputedStyle(cell)
    return { exiting: cell.getAttribute('data-exiting'), animation: style.animationName, duration: style.animationDuration }
  }, added)
  check(
    '删卡先播退场动画',
    exit?.exiting === 'true' && exit.animation === 'dsh-widget-board-card-out' && exit.duration === '0.25s',
    JSON.stringify(exit),
  )
  await page.waitForFunction((count) => document.querySelectorAll('[data-instance]').length === count, before, { timeout: 10000 })
  check('把加进去的卡移掉了', true)
}

/**
 * 分享与导入（D8）：组件库里有导出入口，导出得到的字节能再导入回来；看板导出的包里带着它用到的
 * 组件。
 *
 * @param page - 宿主页面，看板已经打开。
 */
async function sharePass(page) {
  await openLibrary(page)
  const link = await page.waitForSelector('[data-dsh-widget-board-export]', { timeout: 15000 })
  const id = await link.getAttribute('data-dsh-widget-board-export')
  check('组件库里有导出入口', typeof id === 'string' && id !== '', String(id))
  const roundTrip = await page.evaluate(async (widget) => {
    const exported = await fetch(`api/widget-board/library/widget/${encodeURIComponent(widget)}/export`)
    const bytes = await exported.arrayBuffer()
    const imported = await fetch('api/widget-board/library/import?replace=true', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: bytes,
    })
    return { exportStatus: exported.status, type: exported.headers.get('content-type'), bytes: bytes.byteLength, importStatus: imported.status, body: await imported.json() }
  }, id)
  check('导出的响应是 zip', roundTrip.exportStatus === 200 && roundTrip.type === 'application/zip' && roundTrip.bytes > 0, `${roundTrip.exportStatus} ${roundTrip.type} ${roundTrip.bytes}`)
  // 导出的是内置组件：包能解开（否则报的是「不是有效的组件包」），但内置组件不许被覆盖（D8、D17）。
  check('内置组件的包能解开但不会被覆盖', roundTrip.importStatus === 400 && String(roundTrip.body.error).includes('是内置的'), `${roundTrip.importStatus} ${JSON.stringify(roundTrip.body).slice(0, 80)}`)

  const board = await page.evaluate(async () => {
    const snapshot = await (await fetch('api/widget-board/boards')).json()
    const exported = await fetch(`api/widget-board/boards/${encodeURIComponent(snapshot.active)}/export`)
    const pkg = await exported.json()
    return { status: exported.status, cards: Array.isArray(pkg.cards) ? pkg.cards.length : -1, widgets: Array.isArray(pkg.widgets) ? pkg.widgets.length : -1 }
  })
  check('看板导出带着卡片与用到的组件', board.status === 200 && board.cards > 0 && board.widgets > 0, JSON.stringify(board))
  await page.keyboard.press('Escape')
}

/**
 * 三个通用动效模板：翻转、磁吸、全息都由运行时套件驱动，组件本身不挂事件。
 *
 * @param page - 宿主页面，看板已经打开。
 */
async function templatePass(page) {
  const flip = await frameOf(page, FLIP_FRAME)
  check('翻转卡画出来了', await flip.evaluate(() => document.querySelector('.flip-card') !== null))
  const flipCard = flip.locator('.flip-card')
  await flipCard.focus()
  await flipCard.press('Enter')
  await sleep(250)
  const flipped = await flip.evaluate(() => ({
    flipped: document.querySelector('.flip-card')?.classList.contains('is-flipped') === true,
    pressed: document.querySelector('.flip-card')?.getAttribute('aria-pressed'),
  }))
  check('翻转卡可按键盘翻面', flipped.flipped && flipped.pressed === 'true', `${flipped.flipped} / ${flipped.pressed}`)

  const magnetic = await frameOf(page, MAGNETIC_FRAME)
  check('磁吸卡画出来了', await magnetic.evaluate(() => document.querySelector('.magnetic-card') !== null))
  await centerCard(page, '磁吸卡')
  await magnetic.locator('.magnetic-card').hover({ position: { x: 30, y: 40 } })
  await sleep(250)
  const magnet = await magnetic.evaluate(() => {
    const card = document.querySelector('.magnetic-card')
    return {
      x: card?.style.getPropertyValue('--t-magnetic-x') ?? '',
      active: card?.classList.contains('is-magnetic-active') === true,
    }
  })
  check('磁吸卡跟随指针', magnet.active && magnet.x !== '' && magnet.x !== '0px', `${magnet.x} / ${magnet.active}`)

  const holo = await frameOf(page, HOLO_FRAME)
  check('全息卡画出来了', await holo.evaluate(() => document.querySelector('.holo-card') !== null))
  // 看板上卡片多时全息卡可能在折叠下面：先把它滚到视口中间，再悬停。
  await centerCard(page, '全息卡')
  await holo.locator('.holo-card').hover({ position: { x: 24, y: 24 } })
  await sleep(250)
  const sheen = await holo.evaluate(() => {
    const card = document.querySelector('.holo-card')
    return {
      gx: card?.style.getPropertyValue('--t-holo-gx') ?? '',
      gy: card?.style.getPropertyValue('--t-holo-gy') ?? '',
    }
  })
  check('全息高光跟随指针', sheen.gx !== '' && sheen.gx !== '50%' && sheen.gy !== '', `${sheen.gx} / ${sheen.gy}`)
}

/**
 * 读一张卡片在宿主上的布局。
 *
 * @param page - 宿主页面。
 * @param id - 卡片实例的 id。
 * @returns 卡片布局，找不到时为 undefined。
 */
async function layoutOf(page, id) {
  return page.evaluate(async (id) => {
    const workspace = await (await fetch('api/widget-board/boards')).json()
    const board = workspace.boards.find((entry) => entry.id === workspace.active) ?? workspace.boards[0]
    return board.instances.find((instance) => instance.id === id)?.layout
  }, id)
}

/**
 * 等宿主上的布局满足条件：松手之后写入要经过一次往返。
 *
 * @param page - 宿主页面。
 * @param id - 卡片实例的 id。
 * @param done - 判断条件。
 * @returns 满足条件时的布局。
 */
async function waitLayout(page, id, done) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const layout = await layoutOf(page, id)
    if (layout !== undefined && done(layout)) return layout
    await sleep(200)
  }
  throw new Error(`卡片 ${id} 的布局一直没有变成预期的样子：${JSON.stringify(await layoutOf(page, id))}`)
}

/**
 * 拖动与缩放：卡片盒子由用户改，松手写入宿主，刷新之后还在（D16）。
 *
 * @param page - 宿主页面。
 */
async function layoutPass(page) {
  await resetLayout(page)
  await openBoard(page)
  await settled(page)

  const weatherId = await page.evaluate(() => document.querySelector('iframe.dsh-widget-board__frame[title="天气"]')?.closest('[data-instance]')?.getAttribute('data-instance') ?? '')
  const metrics = await page.evaluate(() => {
    const view = document.querySelector('[data-dsh-widget-board-view]')
    const flow = document.querySelector('.dsh-widget-board__flow')
    const columns = Number(view?.getAttribute('data-dsh-widget-board-columns') ?? 0)
    const gap = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.75
    const columnWidth = (flow.getBoundingClientRect().width - gap * (columns - 1)) / columns
    return { step: columnWidth + gap }
  })

  const weatherCard = page.locator(`[data-instance="${weatherId}"]`)
  const startBox = await weatherCard.boundingBox()
  if (startBox === null) throw new Error('天气卡没有盒子')
  const grip = weatherCard.locator(GRIP)
  await grip.hover()
  const gripBox = await grip.boundingBox()
  if (gripBox === null) throw new Error('拖动把手没有盒子')
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(gripBox.x + gripBox.width / 2 - metrics.step * 0.7, gripBox.y + gripBox.height / 2 + 70, { steps: 10 })
  // 虚影有一段很短的滑动，等它落定再读；卡片本身不补间，读完立刻就能对上。
  await sleep(250)
  const during = await page.evaluate(({ id, ghost }) => {
    const card = document.querySelector(`[data-instance="${id}"]`)?.getBoundingClientRect()
    const target = document.querySelector(ghost)?.getBoundingClientRect()
    return {
      card: card === undefined ? null : { left: card.left, top: card.top },
      ghost: target === undefined ? null : { left: target.left, top: target.top },
    }
  }, { id: weatherId, ghost: GHOST })
  check(
    '拖动时卡片跟手，虚影停在格子落点',
    during.card !== null && during.ghost !== null
      && Math.abs(during.card.left - (startBox.x - metrics.step * 0.7)) <= 2
      && Math.abs(during.card.top - (startBox.y + 70)) <= 2
      && Math.abs(during.ghost.left - (startBox.x - metrics.step)) <= 2
      && Math.abs(during.ghost.top - (startBox.y + 64)) <= 2,
    JSON.stringify(during),
  )
  await page.mouse.up()
  const moved = await waitLayout(page, weatherId, (layout) => layout.x === 1 && layout.y > 0)
  check('拖动改写卡片的列与纵向位置', moved.x === 1 && moved.y > 0, JSON.stringify(moved))

  const resize = page.locator(`[data-instance="${weatherId}"] ${RESIZE}`)
  await resize.hover()
  const resizeBox = await resize.boundingBox()
  if (resizeBox === null) throw new Error('缩放手柄没有盒子')
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + metrics.step, resizeBox.y + resizeBox.height / 2 + 64, { steps: 10 })
  const measure = page.locator(`[data-instance="${weatherId}"] ${MEASURE}`)
  const measured = (await measure.textContent())?.replace(/\s+/g, ' ').trim() ?? ''
  check('缩放时显示实时尺寸', (await measure.count()) === 1 && /\d+ × \d+/.test(measured), measured)
  const masked = await page.evaluate(({ id, measure }) => {
    const card = document.querySelector(`[data-instance="${id}"]`)?.getBoundingClientRect()
    const mask = document.querySelector(`[data-instance="${id}"] ${measure}`)?.getBoundingClientRect()
    if (card === undefined || mask === undefined) return null
    return { card, mask }
  }, { id: weatherId, measure: MEASURE })
  check(
    '缩放时尺寸读数铺成覆盖整张卡的遮罩',
    masked !== null
      && Math.abs(masked.card.x - masked.mask.x) <= 1
      && Math.abs(masked.card.y - masked.mask.y) <= 1
      && Math.abs(masked.card.width - masked.mask.width) <= 1
      && Math.abs(masked.card.height - masked.mask.height) <= 1,
    JSON.stringify(masked),
  )
  await page.mouse.up()
  const resized = await waitLayout(page, weatherId, (layout) => layout.w === 2 && layout.h >= 25)
  check('缩放改写卡片的跨列与高度', resized.w === 2 && resized.h >= 25, JSON.stringify(resized))

  const box = await cardBox(page, '天气')
  check('组件跟着新盒子排版', box.width > 500 && Math.abs(box.frameHeight - box.height) <= 1, `${box.width}×${box.height}`)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(PANEL_ICON, { timeout: 120000 })
  await openBoard(page)
  const kept = await layoutOf(page, weatherId)
  check('重载之后布局还在', kept?.x === resized.x && kept?.w === resized.w && kept?.h === resized.h, JSON.stringify(kept))

  await resetLayout(page)
  await sleep(600)
}

/**
 * 窄窗口：列数降到一列，卡片宽度跟着容器走（D16）。
 *
 * @param page - 宿主页面，看板已经打开。
 */
async function narrowPass(page) {
  await page.setViewportSize({ width: 520, height: 900 })
  await sleep(1800)
  const narrow = await page.evaluate(() => ({
    columns: Number(document.querySelector('[data-dsh-widget-board-view]')?.getAttribute('data-dsh-widget-board-columns') ?? 0),
    widths: Array.from(document.querySelectorAll('[data-instance]')).map((node) => Math.round(node.getBoundingClientRect().width)),
  }))
  check('窄窗口里只剩一列', narrow.columns === 1, `${narrow.columns} 列`)
  check('卡片跟着容器变宽', narrow.widths.every((width) => width > 400), narrow.widths.join(' / '))
}

/**
 * 热重载：改一个组件文件，宿主重读组件库，在线页面按新哈希把卡片重挂（D7）。
 *
 * 写的是构建产物 `lib/widgets/`，跑完按原字节写回去；即使中途失败也不会把产物改坏，下一次
 * `npm run build` 也会重写它。
 *
 * @param page - 宿主页面，看板已经打开。
 */
async function reloadPass(page) {
  const target = join(__dirname, '..', '..', 'lib', 'widgets', 'weather', 'style.css')
  const original = await readFile(target)
  // 看的是被改的那张卡：另一张不该跟着换地址。
  const before = await page.evaluate(() => document.querySelector('iframe.dsh-widget-board__frame[title="天气"]')?.src ?? '')
  try {
    await writeFile(target, Buffer.concat([original, Buffer.from('\n/* smoke: 热重载探针 */\n')]))
    // 重挂的瞬间 iframe 的 src 会是空的，所以这里等的是一个非空且不同的地址。
    const after = await page.waitForFunction(
      (previous) => {
        const frame = document.querySelector('iframe.dsh-widget-board__frame[title="天气"]')
        if (frame === null || frame.src === '' || frame.src === previous) return false
        return frame.src
      },
      before,
      { timeout: 20000 },
    ).then((handle) => handle.jsonValue(), () => '')
    check('改了组件文件后卡片按新哈希重挂', after !== '' && after !== before, after === '' ? '一直没换地址' : after.split('/widget/')[1]?.slice(0, 12))
    const frame = await frameOf(page, WEATHER_FRAME)
    check('重挂之后天气卡仍然画出来', await frame.evaluate(() => document.querySelector('.wx') !== null))
    // 选中的是哪一天存在宿主上，重挂之后回来；文案与地点也要重新接上。
    await sleep(600)
    // 热重载可能让同一张卡再换一次地址：等落定之后重新取一次它的 frame，别握着已经拆掉的那一个。
    const settledFrame = await frameOf(page, WEATHER_FRAME)
    const reloaded = await settledFrame.evaluate(() => ({
      place: document.querySelector('#wx-place')?.textContent,
      day: document.querySelector('#wx-day')?.textContent ?? '',
    }))
    check('重挂之后选中的预报日还在', reloaded.day === '星期四', reloaded.day)
    check('重挂之后文案也接上了', reloaded.place === '旧金山', reloaded.place)
  } finally {
    await writeFile(target, original)
  }
  await sleep(1500)
}

/**
 * 减弱动效：天空静置，雨与闪电不画。
 *
 * @param page - 宿主页面。
 */
async function reducedPass(page) {
  await page.waitForSelector(PANEL_ICON, { timeout: 120000 })
  await openBoard(page)
  const weather = await frameOf(page, WEATHER_FRAME)
  check('根部标着减弱动效', (await weather.evaluate(() => document.documentElement.dataset.motion)) === 'reduced')
  const still = await weather.evaluate(() => ({
    blob: getComputedStyle(document.querySelector('.wx-blob')).animationName,
    flash: getComputedStyle(document.querySelector('.wx-flash')).display,
    tabTransition: getComputedStyle(document.querySelector('.t-tabs-pill')).transitionDuration,
  }))
  check('飘动的光斑停住', still.blob === 'none', still.blob)
  check('闪电不画', still.flash === 'none', still.flash)
  check('切换栏不做过渡', still.tabTransition === '0s', still.tabTransition)
}

start({ extras: [join(__dirname, 'fixtures', 'provider')] }).then(async (host) => {
  // 面向会话的工具（D9）：注册发生在宿主启动时，宿主自己的输出是唯一看得见它的地方。插件加载
  // 在地址打印之后，所以等一会儿再看。
  let log = host.log()
  for (let attempt = 0; attempt < 40 && !log.includes('widget-board:'); attempt += 1) {
    await sleep(500)
    log = host.log()
  }
  check('宿主里注册了面向会话的工具', log.includes('widget-board: 注册了 widget_catalog'), log.split('\n').filter((line) => line.includes('widget-board')).join(' / '))
  let opened
  let reduced
  try {
    opened = await openPage(host.url)
    await mainPass(opened.page, opened.problems)
    await noticePass(opened.page, { check, openBoard })
    await templatePass(opened.page)
    await addRemovePass(opened.page)
    await groupPass(opened.page, check)
    await markdownPass(opened.page, check)
    await providerPass(opened.page, check, host.home)
    await sharePass(opened.page)
    await dockPass(opened.page, check)
    await layoutPass(opened.page)
    await narrowPass(opened.page)
    await reloadPass(opened.page)
    // 标签条放在最后：它新建一块看板再收掉，中途失败也不会影响前面的场景。
    await tabsPass(opened.page, { check })
    reduced = await openPage(host.url, { reducedMotion: 'reduce' })
    await reducedPass(reduced.page)
    const errors = reduced.problems.filter((problem) => problem.startsWith('error:') || problem.startsWith('pageerror:'))
    check('减弱动效下控制台没有错误', errors.length === 0, errors.join(' / '))
  } finally {
    // 任何一步抛出来都要把这一轮起的页面与宿主收干净：留着的宿主会占住端口与临时 profile。
    if (opened !== undefined) await opened.close()
    if (reduced !== undefined) await reduced.close()
    host.stop()
  }
  console.log(failures === 0 ? '\nsmoke: 全部通过' : `\nsmoke: ${failures} 条没有通过`)
  process.exitCode = failures === 0 ? 0 : 1
}, (error) => {
  console.error(error)
  process.exitCode = 1
})
