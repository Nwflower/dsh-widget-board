#!/usr/bin/env node
'use strict'
/**
 * titlebar.cjs — Windows 桌面端的标题栏（D21 的标签条）。
 *
 * 走查跑在浏览器里，桌面壳的两样答案用替身给出：根节点上的 `data-windows-titlebar` 标记让宿主
 * 让出 40px 标题栏，`navigator.windowControlsOverlay` 给出标题栏的高度与系统窗口按钮的起点。
 * 标签条自己的判据只读它自己的位置：标题栏放得下时挂在里面，放不下或不在桌面端时留在页面顶部。
 */

const TABS = '[data-dsh-widget-board-tabs]'
const TAB = '[data-dsh-widget-board-tab]'
const MORE = '[data-dsh-widget-board-tab-more]'
const MENU = '[data-dsh-widget-board-board-menu]'
const NEW_TAB = '[data-dsh-widget-board-tab-new]'
const CARD = '.dsh-widget-board__flow[data-active="true"] [data-instance]'
const BAND = 40
const CONTROLS = 140
/** 标题栏左端让给宿主控件与 Desktop 菜单的宽度（titlebar.ts 的 LEADING_CLEARANCE）。 */
const MENU_CLEARANCE = 300
/** 标题栏里标签条与两侧留出的空隙。 */
const AIR = 12
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 装上或撤掉桌面壳替身：根节点标记、标题栏高度与窗口控制层，然后催一次重排。
 *
 * @param page - 宿主页面。
 * @param on - true 时装上，false 时撤掉。
 * @param controls - 系统窗口按钮占的宽度；给出更窄的标题栏来核对放不下的情况。
 */
async function shell(page, on, controls = CONTROLS) {
  await page.evaluate(({ band, controls, on }) => {
    const root = document.documentElement
    if (on) {
      root.setAttribute('data-windows-titlebar', '')
      root.style.setProperty('--dsh-windows-titlebar-height', `${band}px`)
      Object.defineProperty(navigator, 'windowControlsOverlay', {
        configurable: true,
        value: {
          visible: true,
          getTitlebarAreaRect() {
            const right = window.innerWidth - controls
            return { x: 0, y: 0, width: right, height: band, top: 0, left: 0, right, bottom: band }
          },
        },
      })
    } else {
      root.removeAttribute('data-windows-titlebar')
      root.style.removeProperty('--dsh-windows-titlebar-height')
      delete navigator.windowControlsOverlay
    }
    window.dispatchEvent(new Event('resize'))
  }, { band: BAND, controls, on })
}

/**
 * 读一次标签条与它下面第一张卡的位置。
 *
 * @param page - 宿主页面。
 * @returns 定位方式、拖动区属性、标签条与卡片的盒子，以及选中项。
 */
async function state(page) {
  return await page.evaluate(({ tabs, tab, card, pill, board }) => {
    const strip = document.querySelector(tabs)
    const root = document.querySelector(board)
    const fresh = document.querySelector(card)
    const active = strip === null ? null : strip.querySelector(`${tab}[aria-selected="true"]`)
    const marker = strip === null ? null : strip.querySelector(pill)
    const box = (node) => {
      if (node === null) return null
      const rect = node.getBoundingClientRect()
      return {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    }
    return {
      position: strip === null ? '' : getComputedStyle(strip).position,
      region: strip === null ? '' : getComputedStyle(strip).getPropertyValue('-webkit-app-region'),
      radius: strip === null ? '' : getComputedStyle(strip).borderRadius,
      strip: box(strip),
      pill: box(marker),
      active: box(active),
      card: box(fresh),
      root: box(root),
      tabs: Array.from(document.querySelectorAll(tab)).map((node) => node.getAttribute('data-dsh-widget-board-tab')),
      selected: Array.from(document.querySelectorAll(tab)).filter((node) => node.getAttribute('aria-selected') === 'true').map((node) => node.getAttribute('data-dsh-widget-board-tab')),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  }, { tabs: TABS, tab: TAB, card: CARD, pill: '[data-dsh-widget-board-tabs-pill]', board: '.dsh-widget-board' })
}

/**
 * 等标签条换成另一种定位方式。
 *
 * @param page - 宿主页面。
 * @param position - `fixed` 或 `sticky`。
 */
async function waitFor(page, position) {
  await page.waitForFunction(({ tabs, position }) => {
    const strip = document.querySelector(tabs)
    return strip !== null && getComputedStyle(strip).position === position
  }, { tabs: TABS, position }, { timeout: 10000 })
}

/**
 * 标题栏：装得下时挂上去，装不下时留在页面里。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param context - 这一层共用的判定。
 */
async function titlebarPass(page, { check }) {
  // 走查前面的场景把窗口留在 520px 宽；标题栏要按桌面窗口的宽度核对，先换回宽窗口。
  await page.setViewportSize({ width: 1440, height: 900 })
  await sleep(1200)
  await page.waitForSelector(TABS, { timeout: 10000 })
  const browser = await state(page)
  check('浏览器里标签条留在页面顶部', browser.position === 'sticky', browser.position)

  await shell(page, true)
  await waitFor(page, 'fixed')
  // 标签条与药丸停稳再量。
  await sleep(400)
  const lifted = await state(page)
  check('Windows 桌面端让出标题栏时标签条挂进去',
    lifted.strip !== null && lifted.strip.top >= -1 && lifted.strip.bottom <= BAND + 1,
    JSON.stringify(lifted.strip))
  check('标签条在标题栏里竖直居中',
    lifted.strip !== null && lifted.strip.height <= BAND
    && Math.abs((lifted.strip.top + lifted.strip.bottom) / 2 - BAND / 2) <= 1,
    JSON.stringify(lifted.strip))
  check('标签条与标题栏上下留出边距',
    lifted.strip !== null && lifted.strip.top >= 4 && lifted.strip.bottom <= BAND - 4,
    JSON.stringify(lifted.strip))
  check('标签条是 9999 圆角', lifted.radius.startsWith('9999px'), lifted.radius)
  check('标签条在标题栏里放得下，左右都让开',
    lifted.strip !== null && lifted.strip.left >= MENU_CLEARANCE && lifted.strip.right <= lifted.viewport.width - CONTROLS + 1,
    `${JSON.stringify(lifted.strip)} / ${lifted.viewport.width}`)
  check('标签条按内容收窄', lifted.strip !== null && lifted.strip.width < 400, String(lifted.strip?.width))
  check('标签条靠左挂在菜单之后',
    lifted.strip !== null && lifted.root !== null
    && Math.abs(lifted.strip.left - Math.max(lifted.root.left + AIR, MENU_CLEARANCE)) <= 1,
    `${JSON.stringify(lifted.strip)} / root ${JSON.stringify(lifted.root)}`)
  check('挂进标题栏后药丸仍套住活动标签',
    lifted.pill !== null && lifted.active !== null
    && Math.abs(lifted.pill.top - lifted.active.top) <= 1
    && Math.abs(lifted.pill.left - lifted.active.left) <= 1
    && Math.abs(lifted.pill.width - lifted.active.width) <= 1
    && Math.abs(lifted.pill.height - lifted.active.height) <= 1,
    `${JSON.stringify(lifted.pill)} / ${JSON.stringify(lifted.active)}`)
  check('标题栏是拖动区，标签条自己可点', lifted.region === 'no-drag', lifted.region)
  check('卡片从标题栏下方开始', lifted.card !== null && lifted.strip !== null && lifted.card.top >= lifted.strip.bottom - 1,
    `${JSON.stringify(lifted.card)} / ${JSON.stringify(lifted.strip)}`)

  // 看板滚动时标签条留在标题栏，不跟着卡片走。
  await page.evaluate(() => { document.querySelector('.dsh-widget-board').scrollTop = 400 })
  await sleep(400)
  const scrolled = await state(page)
  check('看板滚动时标签条留在标题栏',
    scrolled.position === 'fixed' && scrolled.strip !== null && scrolled.strip.top === lifted.strip?.top,
    `${scrolled.position} / ${JSON.stringify(scrolled.strip)}`)
  await page.evaluate(() => { document.querySelector('.dsh-widget-board').scrollTop = 0 })
  await sleep(300)

  // 标题栏里按得动：更多按钮没被拖动区吞掉，菜单开在看得见的地方。
  const activeId = lifted.selected[0]
  await page.locator(`${MORE}[data-dsh-widget-board-tab-more="${activeId}"]`).click()
  await page.waitForSelector(MENU, { timeout: 5000 })
  const menu = await page.evaluate(({ menu: selector }) => {
    const node = document.querySelector(selector)
    if (node === null) return null
    const rect = node.getBoundingClientRect()
    return { top: Math.round(rect.top), left: Math.round(rect.left), bottom: Math.round(rect.bottom), right: Math.round(rect.right), width: window.innerWidth, height: window.innerHeight }
  }, { menu: MENU })
  check('标题栏里的更多按钮能打开菜单',
    menu !== null && menu.top >= 0 && menu.left >= 0 && menu.bottom <= menu.height && menu.right <= menu.width,
    JSON.stringify(menu))
  await page.keyboard.press('Escape')
  await page.waitForFunction((selector) => document.querySelector(selector) === null, MENU, { timeout: 5000 })

  // 标题栏里按得动：新建入口没被拖动区吞掉。
  const before = lifted.tabs.length
  await page.locator(NEW_TAB).click()
  await page.waitForFunction(({ tabs, count }) => document.querySelectorAll(`${tabs} [data-dsh-widget-board-tab]`).length === count + 1, { tabs: TABS, count: before }, { timeout: 10000 })
  const created = await state(page)
  check('标题栏里的新建入口能按', created.tabs.length === before + 1 && created.selected.length === 1, JSON.stringify(created.selected))
  const extra = created.tabs.find((id) => !lifted.tabs.includes(id))
  // 收掉新建的看板，后面的场景仍然只有原来那一块。
  if (extra !== undefined) {
    await page.evaluate(async (id) => {
      await fetch(`api/widget-board/boards/${encodeURIComponent(id)}/remove`, { method: 'POST' })
    }, extra)
  }
  await page.waitForFunction(({ tabs, count }) => document.querySelectorAll(`${tabs} [data-dsh-widget-board-tab]`).length === count, { tabs: TABS, count: before }, { timeout: 10000 })

  // 把窗口按钮那一端推到 380px 以内，菜单之后只剩 68px：标签条放不下，回到页面里。
  await shell(page, true, lifted.viewport.width - 380)
  await waitFor(page, 'sticky')
  const narrow = await state(page)
  check('标题栏放不下时标签条回到页面里', narrow.position === 'sticky' && narrow.strip !== null && narrow.strip.top > BAND,
    `${narrow.position} / ${JSON.stringify(narrow.strip)}`)

  await shell(page, false)
  await waitFor(page, 'sticky')
  const plain = await state(page)
  check('撤掉桌面壳之后回到普通页面', plain.position === 'sticky' && plain.strip !== null && plain.strip.top <= BAND,
    `${plain.position} / ${JSON.stringify(plain.strip)}`)
}

module.exports = { titlebarPass }
