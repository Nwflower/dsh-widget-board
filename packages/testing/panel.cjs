#!/usr/bin/env node
'use strict'
/**
 * panel.cjs — 打开临时宿主里的看板页：关掉宿主自己的首次启动浮层，按下侧栏入口，等看板出现。
 *
 * 查找只用插件自己的标记（D1）；具体卡片由调用方按标题等。
 */

const PANEL_ICON = 'svg.dsh-widget-board__icon'
const BOARD_VIEW = '[data-dsh-widget-board-view]'
// 设置面板是盖住侧栏的模态；它的一节只在导航选中的时候挂载。
const SETTINGS_MODAL = '[role="dialog"][aria-modal="true"]'
// 设置面板的入口在宿主的账号菜单里，菜单项带一段快捷键文字。
const ACCOUNT_MENU = ['账号菜单', 'Account menu']
const SETTINGS_ENTRY = '设置'
const MORE_BUTTON = '更多'
// 本插件在设置页里那一节的名字，与注册时写的一致（D21）。
const SETTINGS_SECTION = '看板'
const HEALTH_TABLE = '[data-dsh-widget-board-provider-health]'
// 工作区里可能挂着几块看板，只有选中的那块看得见（D21）：等它里面的第一张卡，而不是全页第一张。
const CARD_FRAME = '.dsh-widget-board__flow[data-active="true"] iframe.dsh-widget-board__frame'
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
 * 打开查看看板。
 *
 * @param page - 宿主页面，侧栏入口已经出现。
 */
async function openBoard(page) {
  await dismissOverlays(page)
  await page.evaluate((selector) => document.querySelector(selector)?.closest('button')?.click(), PANEL_ICON)
  await page.waitForSelector(BOARD_VIEW, { timeout: 20000 })
  await page.waitForSelector(CARD_FRAME, { timeout: 30000 })
}

/**
 * 打开宿主设置面板里本插件那一节。
 *
 * 触发按钮按可访问名找，导航里那一节按注册时写的标签找；两处都只认文字与语义化的 `nav` 元素，宿主
 * 换了内部结构也不会让这一处失真（D1）。
 *
 * @param page - 宿主页面。
 */
async function openBoardSettings(page) {
  const opened = await page.evaluate((wanted) => {
    const shown = (element) => element.checkVisibility() && element.getBoundingClientRect().width > 0
    const all = Array.from(document.querySelectorAll('button')).filter(shown)
    // 账号菜单那一枚按它的可访问名找；宿主改了标签时退回菜单按钮的「更多」文字，取最后一个。
    const named = all.find((candidate) => wanted.names.includes(candidate.getAttribute('aria-label') ?? ''))
    const byText = all.filter((candidate) => (candidate.textContent ?? '').trim() === wanted.more && candidate.getAttribute('aria-haspopup') === 'menu').at(-1)
    const button = named ?? byText
    if (button === undefined) return false
    button.click()
    return true
  }, { names: ACCOUNT_MENU, more: MORE_BUTTON })
  if (!opened) throw new Error('侧栏里没有账号菜单')
  await page.waitForSelector('[role="menu"]', { timeout: 20000 })
  const entry = await page.evaluate((label) => {
    const item = Array.from(document.querySelectorAll('[role="menu"] button, [role="menu"] [role="menuitem"]'))
      .find((candidate) => (candidate.textContent ?? '').trim().startsWith(label))
    if (item === undefined) return false
    item.click()
    return true
  }, SETTINGS_ENTRY)
  if (!entry) throw new Error(`账号菜单里没有 ${SETTINGS_ENTRY}`)
  await page.waitForSelector(`${SETTINGS_MODAL} nav`, { timeout: 20000 })
  const selected = await page.evaluate((wanted) => {
    const cells = Array.from(document.querySelectorAll(wanted.modal + ' nav button'))
      .filter((candidate) => (candidate.textContent ?? '').trim() === wanted.label)
    const cell = cells.at(-1)
    if (cell === undefined) return false
    cell.click()
    return true
  }, { modal: SETTINGS_MODAL, label: SETTINGS_SECTION })
  if (!selected) throw new Error(`设置面板的导航里没有 ${SETTINGS_SECTION} 一节`)
  await page.waitForSelector(HEALTH_TABLE, { timeout: 20000 })
}

/**
 * 关掉设置面板：模态自己认 Escape（`useModalLayer`），关掉之后面板与它里的一节一起摘掉。
 *
 * @param page - 宿主页面。
 */
async function closeBoardSettings(page) {
  await page.keyboard.press('Escape')
  await page.waitForSelector(SETTINGS_MODAL, { state: 'detached', timeout: 10000 })
}

module.exports = { closeBoardSettings, dismissOverlays, openBoard, openBoardSettings }
