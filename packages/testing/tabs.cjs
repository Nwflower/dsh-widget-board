#!/usr/bin/env node
'use strict'
/**
 * tabs.cjs — 看板标签的检查（D21）：一条标签条加一个新建入口，切换标签不重挂任何组件。
 *
 * 与看板的打开方式一起使用：页面已经停在看板上时调用。这一段会新建一块看板、切过去再切回来，
 * 最后把它移除，后续场景仍然只有原来那一块。
 *
 * 未选中的看板留在文档里（`visibility: hidden`），所以「看得见」按计算样式判定，不按有没有盒子。
 */

const { frameOf } = require('./frames.cjs')

const TABS = '[data-dsh-widget-board-tabs]'
const TAB = '[data-dsh-widget-board-tab]'
const NEW_TAB = '[data-dsh-widget-board-tab-new]'
const PILL = '[data-dsh-widget-board-tabs-pill]'
const FLOW = '.dsh-widget-board__flow'
const CARD = '[data-instance]'
const POMODORO_FRAME = 'iframe.dsh-widget-board__frame[title="番茄钟"]'

/**
 * 读一次标签条与卡片的状态。
 *
 * @param page - 宿主页面。
 * @returns 标签数、控件数、选中项、药丸、看得见的卡片数与挂载的卡片总数。
 */
async function stripState(page) {
  return await page.evaluate(({ tabs, tab, pill, flow, card }) => {
    const strip = document.querySelector(tabs)
    const buttons = strip === null ? [] : Array.from(strip.querySelectorAll(tab))
    const flows = Array.from(document.querySelectorAll(flow))
    const visible = flows.filter((element) => getComputedStyle(element).visibility !== 'hidden')
    return {
      tabs: buttons.length,
      controls: strip === null ? 0 : strip.querySelectorAll('button').length,
      selected: buttons.filter((button) => button.getAttribute('aria-selected') === 'true').map((button) => button.getAttribute('data-dsh-widget-board-tab')),
      labels: buttons.map((button) => (button.textContent ?? '').trim()),
      pill: strip === null ? null : strip.querySelector(pill) !== null,
      visibleFlows: visible.length,
      visibleCards: visible.reduce((total, element) => total + element.querySelectorAll(card).length, 0),
      mountedCards: document.querySelectorAll(card).length,
    }
  }, { tabs: TABS, tab: TAB, pill: PILL, flow: FLOW, card: CARD })
}

/**
 * 在番茄钟的文档里放一枚记号：记号数的是这份文档被标过几次，重挂之后它会回到 1。
 *
 * @param page - 宿主页面。
 * @returns 记号当前的值。
 */
async function markPomodoro(page) {
  const frame = await frameOf(page, POMODORO_FRAME)
  return await frame.evaluate(() => {
    window.__tabsProbe = (window.__tabsProbe ?? 0) + 1
    return window.__tabsProbe
  })
}

/**
 * 标签条：新建一块看板、切过去、切回来，核对组件没有被重挂。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param context - 这一层共用的判定。
 */
async function tabsPass(page, { check }) {
  await page.waitForSelector(TABS, { timeout: 10000 })
  const before = await stripState(page)
  check('标签条上只有一个标签与一个新建入口', before.tabs === 1 && before.controls === 2, JSON.stringify(before))
  check('活动标签有一枚药丸', before.pill === true && before.selected.length === 1, JSON.stringify(before.selected))
  const firstId = before.selected[0]
  const marker = await markPomodoro(page)
  check('番茄钟的文档已经挂上', marker === 1, String(marker))

  // 新建：多一个标签、它成为选中、它那块是空的，原来那块看板的卡片还在文档里。
  await page.locator(NEW_TAB).click()
  await page.waitForFunction(({ tabs, count }) => document.querySelectorAll(`${tabs} [data-dsh-widget-board-tab]`).length === count + 1, { tabs: TABS, count: before.tabs }, { timeout: 10000 })
  const created = await stripState(page)
  try {
    check('新建之后多一个标签并选中它', created.tabs === 2 && created.selected.length === 1 && created.selected[0] !== firstId, JSON.stringify(created.selected))
    check('新看板是空的，旧看板的卡片仍然挂载', created.visibleCards === 0 && created.mountedCards === before.mountedCards, `${created.visibleCards} / ${created.mountedCards}`)
    check('同时只有一块看板看得见', created.visibleFlows === 1, String(created.visibleFlows))

    // 宿主上当前选中的也换过去了。
    const stored = await page.evaluate(async () => (await fetch('api/widget-board/boards')).json())
    check('宿主记住了选中的那块看板', stored.active === created.selected[0], String(stored.active))

    // 切回来：番茄钟的记号还在，说明它的文档没有被重挂。
    await page.locator(`[data-dsh-widget-board-tab="${firstId}"]`).click()
    await page.waitForFunction(({ tabs, id }) => document.querySelector(`${tabs} [data-dsh-widget-board-tab="${id}"]`)?.getAttribute('aria-selected') === 'true', { tabs: TABS, id: firstId }, { timeout: 10000 })
    const back = await markPomodoro(page)
    // 记号数的是「这份文档被标过几次」：文档还在就是 2，被重挂过就回到 1。
    check('切回原来的看板时组件没有重挂', back === marker + 1, `${back} / ${marker}`)
    const restored = await stripState(page)
    check('切回来之后原来的卡片又看得见', restored.visibleCards === before.visibleCards, `${restored.visibleCards} / ${before.visibleCards}`)
  } finally {
    // 这一段失败也要把新建的那块看板收掉：留着的空看板会成为当前选中，后面的场景就看不到卡片了。
    if (created.selected[0] !== undefined) {
      await page.evaluate(async (id) => {
        await fetch(`api/widget-board/boards/${encodeURIComponent(id)}/remove`, { method: 'POST' })
      }, created.selected[0])
    }
    await page.waitForFunction(({ tabs, count }) => document.querySelectorAll(`${tabs} [data-dsh-widget-board-tab]`).length <= count, { tabs: TABS, count: before.tabs }, { timeout: 10000 })
  }
  check('移除之后回到一个标签', true)
}

module.exports = { tabsPass }
