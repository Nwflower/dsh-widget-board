#!/usr/bin/env node
/**
 * smoke.cjs — 在真实的临时宿主上走一遍插件自己的表面。
 *
 * 检查的是本插件的判据，不看宿主的实现：侧栏出现入口、点开是一页看板、卡片 iframe 里天气卡加载
 * 出来、切换预报日时天空与数字真的换、减弱动效下天空静置、控制台没有错误。查找只用插件自己写在
 * 节点上的标记（`svg.dsh-widget-board__icon` 与 `data-dsh-widget-board-*`），宿主换了内部结构也
 * 不会让这些判据失真（D1）。
 *
 * 用法：node packages/testing/smoke.cjs
 */
'use strict'
const { openPage, start } = require('./dsh-web.cjs')

/** 插件自己画的东西，只用这些标记找节点。 */
const PANEL_ICON = 'svg.dsh-widget-board__icon'
const BOARD_VIEW = '[data-dsh-widget-board-view]'
const CARD_FRAME = 'iframe.dsh-widget-board__frame'
const SHEET = 'style[data-plugin="dsh-widget-board"]'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
 * 打开查看看板，并交回卡片 iframe 的 frame。
 *
 * @param page - 宿主页面，侧栏入口已经出现。
 * @returns 卡片文档的 frame。
 */
async function openBoard(page) {
  await dismissOverlays(page)
  await page.evaluate((selector) => document.querySelector(selector)?.closest('button')?.click(), PANEL_ICON)
  await page.waitForSelector(BOARD_VIEW, { timeout: 20000 })
  const handle = await page.waitForSelector(CARD_FRAME, { timeout: 30000 })
  const frame = await handle.contentFrame()
  if (frame === null) throw new Error('卡片 iframe 没有可用的 frame')
  await frame.waitForSelector('.wx', { timeout: 20000 })
  // 握手把令牌递进去之后，卡片才穿上主题颜色。
  await frame.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--w-color-bg').trim() !== '', undefined, { timeout: 20000 })
  return frame
}

let failures = 0

/** 记一条判据。 */
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  (${detail})`}`)
  if (!ok) failures += 1
}

/**
 * 主路径：入口、看板、天气卡、切换预报日。
 *
 * @param page - 宿主页面。
 * @param problems - 打开页面以来控制台里的错误、警告与未捕获异常。
 */
async function mainPass(page, problems) {
  await page.waitForSelector(PANEL_ICON, { timeout: 120000 })
  check('侧栏出现看板入口', true)
  check('插件的样式表挂上了文档', await page.evaluate((selector) => document.querySelector(selector) !== null, SHEET))
  const frame = await openBoard(page)
  check('中栏打开一页看板', await page.evaluate((selector) => document.querySelector(selector) !== null, BOARD_VIEW))
  check('卡片文档按哈希取到', frame.url().includes('/widget/'), frame.url().replace(/^.*\/plugins/, '/plugins').slice(0, 60))
  check('天气卡画出来了', await frame.evaluate(() => document.querySelector('.wx') !== null))
  check('五个预报日', (await frame.evaluate(() => document.querySelectorAll('.t-tab').length)) === 5)
  check('令牌进了 iframe', (await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--w-color-bg').trim())) !== '')

  const day = await frame.evaluate(() => document.querySelector('#wx-day')?.textContent ?? '')
  await frame.locator('#wx-tab-3').click()
  await frame.waitForFunction(() => document.querySelector('.wx-bg')?.getAttribute('data-wx') === 'storm', undefined, { timeout: 5000 })
  await sleep(400)
  const after = await frame.evaluate(() => ({
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

  const errors = problems.filter((problem) => problem.startsWith('error:') || problem.startsWith('pageerror:'))
  check('控制台没有错误', errors.length === 0, errors.join(' / '))
  const warnings = problems.filter((problem) => problem.startsWith('warning:'))
  if (warnings.length > 0) console.log(`      控制台里有 ${warnings.length} 条警告：${warnings.join(' / ')}`)
}

/**
 * 减弱动效：天空静置，雨与闪电不画。
 *
 * @param page - 宿主页面。
 */
async function reducedPass(page) {
  await page.waitForSelector(PANEL_ICON, { timeout: 120000 })
  const frame = await openBoard(page)
  check('根部标着减弱动效', (await frame.evaluate(() => document.documentElement.dataset.motion)) === 'reduced')
  const still = await frame.evaluate(() => ({
    blob: getComputedStyle(document.querySelector('.wx-blob')).animationName,
    flash: getComputedStyle(document.querySelector('.wx-flash')).display,
    tabTransition: getComputedStyle(document.querySelector('.t-tabs-pill')).transitionDuration,
  }))
  check('飘动的光斑停住', still.blob === 'none', still.blob)
  check('闪电不画', still.flash === 'none', still.flash)
  check('切换栏不做过渡', still.tabTransition === '0s', still.tabTransition)
}

/**
 * 窄窗口：断点按容器宽度重新判定，尺寸族跟着降级，iframe 里收到的族与看板一致（D4）。
 *
 * @param page - 宿主页面，看板已经打开。
 */
async function narrowPass(page) {
  await page.setViewportSize({ width: 520, height: 900 })
  await sleep(1500)
  const board = await page.evaluate(() => ({
    width: document.querySelector('[data-dsh-widget-board-view]')?.clientWidth,
    family: document.querySelector('[data-instance]')?.getAttribute('data-family'),
  }))
  check('窄窗口里降级到 s 族', board.family === 's', `容器 ${board.width}px，族 ${board.family}`)
  const handle = await page.$('iframe.dsh-widget-board__frame')
  const frame = await handle.contentFrame()
  const inside = await frame.evaluate(() => ({
    size: document.documentElement.dataset.size,
    cols: getComputedStyle(document.documentElement).getPropertyValue('--w-cols').trim(),
    width: Math.round(document.querySelector('.wx').getBoundingClientRect().width),
  }))
  check('iframe 里的尺寸族与看板一致', inside.size === board.family, `${board.family} / ${inside.size}`)
  check('组件拿到列数', inside.cols === '2', inside.cols)
  check('卡片铺满窄窗口的宽度', inside.width > 200, `${inside.width}px`)
}

start().then(async (host) => {
  let opened
  try {
    opened = await openPage(host.url)
    await mainPass(opened.page, opened.problems)
    await narrowPass(opened.page)
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
