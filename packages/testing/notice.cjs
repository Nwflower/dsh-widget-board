#!/usr/bin/env node
'use strict'
/**
 * notice.cjs — 通知与徽标的检查（D7）：组件发一条，看板入口亮起条数、悬停能读到标题与正文，
 * 入口被点过之后清零；番茄钟到点也走同一条路。
 *
 * 与看板的打开方式一起使用：页面已经停在看板上时调用。
 */

const { frameOf } = require('./frames.cjs')

const PANEL_ICON = 'svg.dsh-widget-board__icon'
const POMODORO_FRAME = 'iframe.dsh-widget-board__frame[title="番茄钟"]'
const BADGE = '[data-dsh-widget-board-badge]'
const BADGE_ANCHOR = '[data-dsh-widget-board-panel-icon]'

/**
 * 通知与徽标：组件发一条、条数累加、入口清零，以及番茄钟到点后自己发的那一条。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param context - 这一层共用的判定与打开看板。
 */
async function noticePass(page, { check, openBoard }) {
  const pomodoro = await frameOf(page, POMODORO_FRAME)
  await pomodoro.evaluate(() => { window.widget?.notify({ title: '完成', body: '这一段结束了' }) })
  await page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute('data-open') === 'true', BADGE, { timeout: 5000 })
  const first = await page.evaluate(({ badge, anchor }) => {
    const node = document.querySelector(badge)
    return {
      count: node?.querySelector('.dsh-widget-board__badge-dot')?.textContent,
      open: node?.getAttribute('data-open'),
      title: document.querySelector(anchor)?.getAttribute('title') ?? '',
      animation: node === null || node === undefined ? '' : getComputedStyle(node).animationName,
    }
  }, { badge: BADGE, anchor: BADGE_ANCHOR })
  check('组件发一条通知，看板入口亮起一条', first.count === '1' && first.open === 'true', JSON.stringify(first))
  check('通知的标题与正文进到入口的提示里', first.title.includes('完成') && first.title.includes('这一段结束了'), first.title)
  check('徽标按 notification badge 的动效滑入', first.animation === 'dsh-widget-board-badge-slide', first.animation)

  await pomodoro.evaluate(() => { window.widget?.notify({ title: '再来一条' }) })
  await page.waitForFunction((selector) => {
    const node = document.querySelector(selector)
    return node?.getAttribute('data-open') === 'true' && node.querySelector('.dsh-widget-board__badge-dot')?.textContent === '2'
  }, BADGE, { timeout: 5000 })
  check('通知条数累加', true)
  // 点的是入口里的图形本身：未读清零挂在它上面，直接点外层按钮不会走到这段处理。
  await page.evaluate((selector) => document.querySelector(selector)?.click(), BADGE_ANCHOR)
  await page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute('data-open') === 'false', BADGE, { timeout: 5000 })
  check('点看看板入口之后未读清零', true)

  // 番茄钟到点自己发一条：把结束时刻改成过去，重载后组件从宿主状态恢复，走 stop(true) 那条路。
  const id = await page.evaluate(() => document.querySelector('iframe.dsh-widget-board__frame[title="番茄钟"]')?.closest('[data-instance]')?.getAttribute('data-instance') ?? '')
  await page.evaluate(async (id) => {
    await fetch(`api/widget-board/instance/${id}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patch: { minutes: 5, endsAt: Date.now() - 1000 } }),
    })
  }, id)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(PANEL_ICON, { timeout: 120000 })
  await openBoard(page)
  await page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute('data-open') === 'true', BADGE, { timeout: 10000 })
  const finished = await page.evaluate((selector) => document.querySelector(`${selector} .dsh-widget-board__badge-dot`)?.textContent, BADGE)
  check('番茄钟到点后自己发通知', finished === '1', finished)
}

module.exports = { noticePass }
