#!/usr/bin/env node
/**
 * smoke.cjs — 在真实的临时宿主上走一遍插件自己的表面。
 *
 * 检查的是本插件的判据，不看宿主的实现：侧栏出现入口、点开是一页信息流看板、两张卡片各自加载
 * 出来、天气卡切预报日与番茄钟开合计时都真的动、窄窗口里列数降到一列、减弱动效下天空静置、
 * 控制台没有错误。查找只用插件自己写在节点上的标记（`svg.dsh-widget-board__icon`、
 * `data-dsh-widget-board-*`、卡片的 iframe `title`），宿主换了内部结构也不会让这些判据失真（D1）。
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
const FLOW = '.dsh-widget-board__flow'
const CARD_FRAME = 'iframe.dsh-widget-board__frame'
const SHEET = 'style[data-plugin="dsh-widget-board"]'
/** 两张内置卡片的 iframe 标题，来自 manifest 的中文标题。 */
const WEATHER_FRAME = 'iframe.dsh-widget-board__frame[title="天气"]'
const POMODORO_FRAME = 'iframe.dsh-widget-board__frame[title="番茄钟"]'

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
 * 等一张卡片的高度跟它内容的高度对上：卡片高度由组件上报（D15）。
 *
 * @param page - 宿主页面。
 * @param title - 卡片 iframe 的标题。
 * @returns 卡片的内容高度。
 */
async function settleCard(page, title) {
  const frame = await frameOf(page, `iframe.dsh-widget-board__frame[title="${title}"]`)
  const content = await frame.evaluate(() => Math.round(document.body.getBoundingClientRect().height))
  await page.waitForFunction(({ title, content }) => {
    const card = document.querySelector(`iframe.dsh-widget-board__frame[title="${title}"]`)?.closest('[data-instance]')
    return card !== null && card !== undefined && Math.abs(card.getBoundingClientRect().height - content) <= 1
  }, { title, content }, { timeout: 20000 })
  return content
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
 * 把两张卡的会话清回初始值：卡片的状态存在宿主上，上一轮跑剩的计时与选中日期会让这一轮的判定漂。
 *
 * @param page - 宿主页面，看板还没打开。
 */
async function resetCards(page) {
  const instances = await page.evaluate(async () => {
    const snapshot = await (await fetch('api/widget-board/board')).json()
    return snapshot.board.instances.map((instance) => ({ id: instance.id, widget: instance.widget }))
  })
  const patches = { pomodoro: { minutes: 25, endsAt: 0 }, weather: { day: 0 } }
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
 * 主路径：入口、信息流、天气卡切预报日、番茄钟开合。
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
  check('中栏打开一页看板', await page.evaluate((selector) => document.querySelector(selector) !== null, BOARD_VIEW))

  const columns = await page.evaluate(() => Number(document.querySelector('[data-dsh-widget-board-view]')?.getAttribute('data-flow-columns') ?? 0))
  check('信息流按容器宽度分列', columns >= 1, `${columns} 列`)

  const weatherHeight = await settleCard(page, '天气')
  const pomodoroHeight = await settleCard(page, '番茄钟')
  check('卡片高度由内容决定', weatherHeight > 300 && pomodoroHeight > 200, `天气 ${weatherHeight} / 番茄钟 ${pomodoroHeight}`)
  await settled(page)

  const boxes = await page.evaluate(() => Array.from(document.querySelectorAll('[data-instance]')).map((node) => {
    const rect = node.getBoundingClientRect()
    return { id: node.getAttribute('data-instance'), width: Math.round(rect.width), height: Math.round(rect.height), left: Math.round(rect.left), top: Math.round(rect.top) }
  }))
  check('两张卡片都在看板上', boxes.length === 2, boxes.map((box) => `${box.width}×${box.height}`).join(' / '))
  const [first, second] = boxes
  const overlap = first !== undefined && second !== undefined &&
    first.left < second.left + second.width && second.left < first.left + first.width &&
    first.top < second.top + second.height && second.top < first.top + first.height
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
  await sleep(200)
  check('拖动滑动条换数字', (await pomodoro.evaluate(() => document.querySelector('#pomo-digits')?.textContent)) === '40')
  await pomodoro.locator('#pomo-start').click()
  await sleep(200)
  const running = await pomodoro.evaluate(() => ({
    pressed: document.querySelector('#pomo-start')?.getAttribute('aria-pressed'),
    label: document.querySelector('#pomo-start-label')?.textContent,
    disabled: document.querySelector('#pomo-range')?.disabled,
  }))
  check('开始时按钮换成结束', running.pressed === 'true' && running.label === '结束这一段', running.label)
  check('运行中不能再改时长', running.disabled === true)

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
    digits: document.querySelector('#pomo-digits')?.textContent,
  }))
  check('重载之后计时还在跑', back.pressed === 'true' && back.disabled === true, `${back.pressed} / ${back.caption}`)
  check('剩下的时长还在', back.digits === '40', back.digits)

  await resumed.locator('#pomo-start').click()
  await sleep(400)
  check('结束之后回到未运行', (await resumed.evaluate(() => document.querySelector('#pomo-start')?.getAttribute('aria-pressed'))) === 'false')

  const live = await page.evaluate(async () => {
    const response = await fetch('api/widget-board/events', { headers: { accept: 'text/event-stream' } })
    const reader = response.body.getReader()
    const { value } = await reader.read()
    await reader.cancel()
    return { status: response.status, first: new TextDecoder().decode(value ?? new Uint8Array()).trim() }
  })
  check('变更通知接得上，先补一个修订号', live.status === 200 && /^data: \{"revision":\d+\}$/.test(live.first), live.first)

  const errors = problems.filter((problem) => problem.startsWith('error:') || problem.startsWith('pageerror:'))
  check('控制台没有错误', errors.length === 0, errors.join(' / '))
  const warnings = problems.filter((problem) => problem.startsWith('warning:'))
  if (warnings.length > 0) console.log(`      控制台里有 ${warnings.length} 条警告：${warnings.join(' / ')}`)
}

/**
 * 窄窗口：列数降到一列，卡片宽度跟着容器走（D15）。
 *
 * @param page - 宿主页面，看板已经打开。
 */
async function narrowPass(page) {
  await page.setViewportSize({ width: 520, height: 900 })
  await sleep(1800)
  const narrow = await page.evaluate(() => ({
    columns: Number(document.querySelector('[data-dsh-widget-board-view]')?.getAttribute('data-flow-columns') ?? 0),
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

start().then(async (host) => {
  let opened
  try {
    opened = await openPage(host.url)
    await mainPass(opened.page, opened.problems)
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
