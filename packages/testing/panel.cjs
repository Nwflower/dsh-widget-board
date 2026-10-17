#!/usr/bin/env node
'use strict'
/**
 * panel.cjs — 打开临时宿主里的看板页：关掉宿主自己的首次启动浮层，按下侧栏入口，等看板出现。
 *
 * 查找只用插件自己的标记（D1）；具体卡片由调用方按标题等。
 */

const PANEL_ICON = 'svg.dsh-widget-board__icon'
const BOARD_VIEW = '[data-dsh-widget-board-view]'
const CARD_FRAME = 'iframe.dsh-widget-board__frame'
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

module.exports = { dismissOverlays, openBoard }
