#!/usr/bin/env node
'use strict'
/**
 * group.cjs — 固定翻面组的真实宿主检查（D19）。
 *
 * 从组件库加一张日历组：正面与背面各是一张普通卡片，右上角的按钮换面，整组一起移除。正面是月历，
 * 换面不接管指针，所以月历自己的翻月按钮仍然点得动。只认插件自己写在节点上的标记，看板数据不从
 * 宿主 DOM 里读。
 */
const { openLibrary } = require('./library.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 加一张日历组、翻月、换面、再整组移除。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param check - 记一条判据的函数。
 */
async function groupPass(page, check) {
  const before = await page.evaluate(() => document.querySelectorAll('[data-instance]').length)
  await openLibrary(page)
  await page.waitForSelector('[data-dsh-widget-board-add="flip-group"]', { timeout: 10000 })
  // 上一张卡片的添加/移除还没落定时，组件库里的格子是禁用的；等它可用再点。
  await page.waitForFunction(() => document.querySelector('[data-dsh-widget-board-add="flip-group"]')?.getAttribute('aria-disabled') !== 'true', undefined, { timeout: 10000 })
  check('组件库里有日历组', true)
  await page.locator('[data-dsh-widget-board-add="flip-group"]').click()
  await page.waitForFunction((count) => document.querySelectorAll('[data-instance]').length === count + 1, before, { timeout: 15000 })
  const id = await page.evaluate(() => Array.from(document.querySelectorAll('[data-instance]')).at(-1)?.getAttribute('data-instance') ?? '')
  check('日历组占一个卡片盒子', id !== '')
  // 加组之后设置弹窗直接打开：先关掉，再验换面与移除。
  await page.waitForSelector('[data-dsh-widget-board-editor]', { timeout: 10000 })
  await page.locator('[data-dsh-widget-board-editor-done]').click()
  await page.waitForSelector('[data-dsh-widget-board-editor]', { state: 'detached', timeout: 10000 })
  const group = `[data-instance="${id}"] [data-dsh-widget-board-flip-group]`
  await page.waitForSelector(group, { timeout: 10000 })
  await page.waitForSelector(`${group} iframe[title="月历"]`, { timeout: 30000 })
  await page.waitForSelector(`${group} iframe[title="今日运势"]`, { timeout: 30000 })
  const faces = await page.evaluate((selector) => {
    const node = document.querySelector(selector)
    return { faces: node?.querySelectorAll('.dsh-widget-board__flip-face').length ?? 0, frames: node?.querySelectorAll('iframe').length ?? 0 }
  }, group)
  check('日历组正面与背面各一张卡', faces.faces === 2 && faces.frames === 2, `${faces.faces} 层 / ${faces.frames} 个画面`)

  await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'center' }), group)
  await sleep(300)

  // 正面是月历：它自己的翻月按钮要点得动，换面按钮不能压住它。
  const calendar = page.frameLocator(`[data-instance="${id}"] .dsh-widget-board__flip-face--front iframe`)
  const month = await calendar.locator('[data-field="month"]').textContent()
  await calendar.locator('[data-step="1"]').click()
  await sleep(300)
  const nextMonth = await calendar.locator('[data-field="month"]').textContent()
  check('月历自己的翻月按钮点得动', nextMonth !== month, `${month} → ${nextMonth}`)
  await calendar.locator('[data-role="today"]').click()
  await sleep(200)
  const days = await calendar.locator('.cal-day').count()
  check('日期格按周数铺满', days >= 28 && days % 7 === 0, `${days} 格`)

  const flipped = await page.evaluate((selector) => document.querySelector(selector)?.getAttribute('data-flipped') === 'true', group)
  check('加进来的组停在正面', !flipped)
  await page.locator(`[data-instance="${id}"] [data-dsh-widget-board-handle="flip"]`).click()
  await page.mouse.move(10, 10)
  await sleep(400)
  const backShown = await page.evaluate((selector) => {
    const node = document.querySelector(selector)
    const inner = node?.querySelector('.dsh-widget-board__flip-inner')
    return node?.getAttribute('data-flipped') === 'true' && inner?.classList.contains('is-flipped') === true
  }, group)
  check('点翻面按钮换到背面，指针移开也停在背面', backShown)
  const fortune = page.frameLocator(`[data-instance="${id}"] .dsh-widget-board__flip-face--back iframe`)
  const score = await fortune.locator('[data-field="score"]').textContent()
  const seal = await fortune.locator('[data-field="seal"]').textContent()
  check('背面画的是今日运势', /^\d+$/.test(score ?? '') && ['大吉', '吉', '平', '小凶', '凶'].includes(seal ?? ''), `${seal} ${score} 分`)
  const yi = await fortune.locator('[data-field="yi"]').textContent()
  check('背面写着今天的宜忌', (yi ?? '').trim() !== '', yi ?? '')

  await page.locator(`[data-instance="${id}"] [data-dsh-widget-board-handle="flip"]`).click()
  await sleep(400)
  const frontAgain = await page.evaluate((selector) => document.querySelector(selector)?.getAttribute('data-flipped') !== 'true', group)
  check('再点一次回到正面', frontAgain)

  await page.locator(`[data-instance="${id}"] [data-dsh-widget-board-handle="remove"]`).click()
  await page.waitForFunction((count) => document.querySelectorAll('[data-instance]').length === count, before, { timeout: 10000 })
  check('日历组整组移除', true)
}

module.exports = { groupPass }
