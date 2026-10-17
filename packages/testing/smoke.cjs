#!/usr/bin/env node
/**
 * smoke.cjs — 在真实的临时宿主上走一遍插件自己的表面。
 *
 * 检查的是本插件的判据，不看宿主的实现：侧栏出现入口、点开是一页卡片栅格、三张卡片各自加载
 * 出来、天气卡切预报日与番茄钟开合计时都真的动、拖动与缩放会改写卡片盒子并保存到宿主、窄窗口里
 * 列数降到一列、减弱动效下天空静置、控制台没有错误。查找只用插件自己写在节点上的标记
 * （`svg.dsh-widget-board__icon`、`data-dsh-widget-board-*`、卡片的 iframe `title`），宿主换了
 * 内部结构也不会让这些判据失真（D1）。
 *
 * 用法：node packages/testing/smoke.cjs
 */
'use strict'
const { readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { openPage, start } = require('./dsh-web.cjs')

/** 插件自己画的东西，只用这些标记找节点。 */
const PANEL_ICON = 'svg.dsh-widget-board__icon'
const BOARD_VIEW = '[data-dsh-widget-board-view]'
const MASTHEAD = '[data-dsh-widget-board-masthead]'
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let failures = 0

/** 记一条判据。 */
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  (${detail})`}`)
  if (!ok) failures += 1
}

/**
 * 关掉宿主自己在首次启动时打开的浮层。
 *
 * 全新的 `$DSH_HOME` 会依次弹出预告与凭据表单，底下压着一层挡住指针的遮罩。每层都用自己的
 * 按钮回答；连续两次都按不到按钮才算关完了，因为关掉一层之后下一层要过一会儿才挂上来。
 *
 * @param page - 临时宿主上的页面。
 */
async function dismissOverlays(page) {
  let quiet = 0
  for (let pass = 0; pass < 10 && quiet < 2; pass += 1) {
    const pressed = await page.evaluate(() => {
      const shown = (element) => element.checkVisibility() && element.getBoundingClientRect().width > 0
      const layer = Array.from(document.querySelectorAll('[role="dialog"], [role="presentation"]')).filter(shown).pop()
      if (layer === undefined) return false
      const button = Array.from(layer.querySelectorAll('button')).filter(shown)[0]
      if (button === undefined) return false
      button.click()
      return true
    })
    quiet = pressed ? 0 : quiet + 1
    await sleep(1200)
  }
}

/**
 * 打开查看看板。
 *
 * @param page - 宿主页面，侧栏入口已经出现。
 */
async function openBoard(page) {
  await dismissOverlays(page)
  await page.evaluate((selector) => document.querySelector(selector)?.closest('button')?.click(), PANEL_ICON)
  await page.waitForSelector(BOARD_VIEW, { timeout: 20000 })
  await page.waitForSelector(POMODORO_FRAME, { timeout: 30000 })
  await page.waitForSelector(WEATHER_FRAME, { timeout: 30000 })
}

/**
 * 等一张卡片的文档完成握手（令牌进了 iframe 才算接上）。
 *
 * @param page - 宿主页面。
 * @param selector - 那张卡片的 iframe。
 * @returns 卡片的 frame。
 */
async function frameOf(page, selector) {
  // 卡片可能正在重挂：iframe 存在但文档还没起来的瞬间要等一等。单次等待要短，
  // 否则一次卡在空白文档上就会把后面的重试全耗掉。
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const handle = await page.$(selector)
    if (handle !== null) {
      const frame = await handle.contentFrame()
      if (frame !== null) {
        const wired = await frame.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--w-color-bg').trim() !== '', undefined, { timeout: 3000 })
          .then(() => true, () => false)
        if (wired) return frame
      }
    }
    await sleep(250)
  }
  throw new Error(`卡片的 iframe 一直没有接上：${selector}\n页面里的 frame：\n${page.frames().map((frame) => `  ${frame.url().slice(-60)}`).join('\n')}`)
}

/**
 * 量一张卡片的盒子与它里面 iframe 的盒子：组件填满卡片，卡片大小由布局给出（D16）。
 *
 * @param page - 宿主页面。
 * @param title - 卡片 iframe 的标题。
 * @returns 两个盒子的像素尺寸。
 */
async function cardBox(page, title) {
  await page.waitForSelector(`iframe.dsh-widget-board__frame[title="${title}"]`, { timeout: 20000 })
  await page.waitForFunction((title) => {
    const frame = document.querySelector(`iframe.dsh-widget-board__frame[title="${title}"]`)
    const card = frame?.closest('[data-instance]')
    return card !== null && card !== undefined && card.getBoundingClientRect().height > 60
  }, title, { timeout: 20000 })
  return page.evaluate((title) => {
    const frame = document.querySelector(`iframe.dsh-widget-board__frame[title="${title}"]`)
    const card = frame?.closest('[data-instance]')
    const outer = card.getBoundingClientRect()
    const inner = frame.getBoundingClientRect()
    return {
      width: Math.round(outer.width),
      height: Math.round(outer.height),
      frameWidth: Math.round(inner.width),
      frameHeight: Math.round(inner.height),
    }
  }, title)
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
 * 把两张卡的会话清回初始值：卡片的状态存在宿主上，上一轮跑剩的计时与选中日期会让这一轮的判定漂。
 *
 * @param page - 宿主页面，看板还没打开。
 */
async function resetCards(page) {
  const instances = await page.evaluate(async () => {
    const snapshot = await (await fetch('api/widget-board/board')).json()
    return snapshot.board.instances.map((instance) => ({ id: instance.id, widget: instance.widget }))
  })
  const patches = { pomodoro: { minutes: 25, endsAt: 0 }, weather: { day: 0 }, todo: { items: [] } }
  for (const instance of instances) {
    const patch = patches[instance.widget]
    if (patch === undefined) continue
    await page.evaluate(async ({ id, patch }) => {
      await fetch(`api/widget-board/instance/${id}/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch }),
      })
    }, { id: instance.id, patch })
  }
}

/**
 * 把卡片盒子清回一排默认大小：上一轮拖动或缩放留下的布局会让几何与点击点漂。
 *
 * @param page - 宿主页面，看板还没打开。
 */
async function resetLayout(page) {
  const snapshot = await page.evaluate(async () => (await fetch('api/widget-board/board')).json())
  const layouts = {}
  snapshot.board.instances.forEach((instance, index) => {
    layouts[instance.id] = { x: index % 4, y: 0, w: 1, h: 22 }
  })
  await page.evaluate(async ({ layoutRevision, layouts }) => {
    await fetch('api/widget-board/board/layout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layoutRevision, layouts }),
    })
  }, { layoutRevision: snapshot.board.layoutRevision, layouts })
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
  await resetLayout(page)
  await openBoard(page)
  check('中栏打开一页看板', await page.evaluate((selector) => document.querySelector(selector) !== null, BOARD_VIEW))
  check('看板的题头出现', await page.evaluate((selector) => document.querySelector(selector) !== null, MASTHEAD))

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
  check('三张卡片都在看板上', boxes.length === 3, boxes.map((box) => `${box.width}×${box.height}`).join(' / '))
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
  check('刻度铺满一滑动条', (await pomodoro.evaluate(() => document.querySelectorAll('.pomo-tick').length)) === 46)
  const labels = await pomodoro.evaluate(() => ({
    title: document.querySelector('#pomo-title')?.textContent,
    caption: document.querySelector('#pomo-cap')?.textContent,
  }))
  check('番茄钟的文案接上了', labels.title === '专注时间' && labels.caption === '选一段专注时长', `${labels.title} / ${labels.caption}`)
  await pomodoro.evaluate(() => {
    const range = document.querySelector('#pomo-range')
    range.value = '40'
    range.dispatchEvent(new Event('input', { bubbles: true }))
  })
  // 翻页半秒之内落定，等它停稳再读。
  await sleep(600)
  check('拖动滑动条换数字', (await timeOf(pomodoro)) === '40:00')
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
  const pomodoroId = await page.evaluate(() => {
    const frame = document.querySelector('iframe.dsh-widget-board__frame[title="番茄钟"]')
    return frame?.closest('[data-instance]')?.getAttribute('data-instance') ?? ''
  })
  const stored = await page.evaluate(async (id) => {
    const snapshot = await (await fetch('api/widget-board/board')).json()
    return snapshot.board.instances.find((instance) => instance.id === id)?.state ?? null
  }, pomodoroId)
  check('宿主存下了结束时刻', typeof stored?.endsAt === 'number' && stored.endsAt > Date.now(), JSON.stringify(stored))

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(PANEL_ICON, { timeout: 120000 })
  await openBoard(page)
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

  await resumed.locator('#pomo-start').click()
  await sleep(400)
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
 * 添加与移除（D17）：题头的按钮打开组件库，点一个组件多一张卡，再把它移掉。
 *
 * @param page - 宿主页面，看板已经打开。
 */
async function addRemovePass(page) {
  const before = await page.evaluate(() => document.querySelectorAll('[data-instance]').length)
  await page.locator('[data-dsh-widget-board-add-open]').click()
  await page.waitForSelector('[data-dsh-widget-board-library]', { timeout: 5000 })
  const listed = await page.evaluate(() => document.querySelectorAll('[data-dsh-widget-board-add]').length)
  check('组件库列出全部组件', listed >= 3, `${listed} 个`)
  await page.locator('[data-dsh-widget-board-add="weather"]').click()
  await page.waitForFunction((count) => document.querySelectorAll('[data-instance]').length === count + 1, before, { timeout: 10000 })
  check('从组件库加了一张卡', true)
  const added = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('[data-instance]'))
    return cells.at(-1)?.getAttribute('data-instance') ?? ''
  })
  await page.locator(`[data-instance="${added}"] [data-dsh-widget-board-handle="remove"]`).click()
  await page.waitForFunction((count) => document.querySelectorAll('[data-instance]').length === count, before, { timeout: 10000 })
  check('把加进去的卡移掉了', true)
}

/**
 * 插件提供的组件（D17）：组件库里有它，加进来之后由插件登记的原生组件渲染，数据来自插件的数据源。
 *
 * @param page - 宿主页面，看板已经打开。
 */
async function providerPass(page) {
  await page.locator('[data-dsh-widget-board-add-open]').click()
  await page.waitForSelector('[data-dsh-widget-board-add="test-native"]', { timeout: 15000 })
  check('插件提供的组件出现在组件库里', true)
  await page.locator('[data-dsh-widget-board-add="test-native"]').click()
  const native = '[data-native-widget="dsh-widget-board-test-provider"]'
  await page.waitForSelector(native, { timeout: 15000 })
  const count = (await page.locator(native).innerText()).trim()
  check('原生组件拿到数据源的数据', count === '7', count)
  const id = await page.evaluate((selector) => document.querySelector(selector)?.closest('[data-instance]')?.getAttribute('data-instance') ?? '', native)
  await page.locator(`[data-instance="${id}"] [data-dsh-widget-board-handle="remove"]`).click()
  await page.waitForFunction((selector) => document.querySelector(selector) === null, native, { timeout: 10000 })
  check('移除插件提供的卡片', true)
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
    const snapshot = await (await fetch('api/widget-board/board')).json()
    return snapshot.board.instances.find((instance) => instance.id === id)?.layout
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
      && Math.abs(during.ghost.top - (startBox.y + 72)) <= 2,
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
    const reloaded = await frame.evaluate(() => ({
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
  let opened
  try {
    opened = await openPage(host.url)
    await mainPass(opened.page, opened.problems)
    await addRemovePass(opened.page)
    await providerPass(opened.page)
    await layoutPass(opened.page)
    await narrowPass(opened.page)
    await reloadPass(opened.page)
  } finally {
    if (opened !== undefined) await opened.close()
  }
  let reduced
  try {
    reduced = await openPage(host.url, { reducedMotion: 'reduce' })
    await reducedPass(reduced.page)
    const errors = reduced.problems.filter((problem) => problem.startsWith('error:') || problem.startsWith('pageerror:'))
    check('减弱动效下控制台没有错误', errors.length === 0, errors.join(' / '))
  } finally {
    if (reduced !== undefined) await reduced.close()
    host.stop()
  }
  console.log(failures === 0 ? '\nsmoke: 全部通过' : `\nsmoke: ${failures} 条没有通过`)
  process.exitCode = failures === 0 ? 0 : 1
}, (error) => {
  console.error(error)
  process.exitCode = 1
})
