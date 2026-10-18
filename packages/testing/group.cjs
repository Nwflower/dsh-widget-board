#!/usr/bin/env node
'use strict'
/**
 * group.cjs — 固定翻面组的真实宿主检查（D19）。
 *
 * 从组件库加一张翻面组：正面与背面各是一张普通卡片，鼠标移上去翻面，整组一起移除。只认插件自己
 * 写在节点上的标记，看板数据不从宿主 DOM 里读。
 */
const { openLibrary } = require('./library.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 加一张翻面组、悬停翻面、离开翻回、再整组移除。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param check - 记一条判据的函数。
 */
async function groupPass(page, check) {
  const before = await page.evaluate(() => document.querySelectorAll('[data-instance]').length)
  await openLibrary(page)
  await page.waitForSelector('[data-dsh-widget-board-add="flip-group"]', { timeout: 10000 })
  check('组件库里有翻面组', true)
  await page.locator('[data-dsh-widget-board-add="flip-group"]').click()
  await page.waitForFunction((count) => document.querySelectorAll('[data-instance]').length === count + 1, before, { timeout: 15000 })
  const id = await page.evaluate(() => Array.from(document.querySelectorAll('[data-instance]')).at(-1)?.getAttribute('data-instance') ?? '')
  check('翻面组占一个卡片盒子', id !== '')
  // 加组之后设置弹窗直接打开：先关掉，再验翻面与移除。
  await page.waitForSelector('[data-dsh-widget-board-editor]', { timeout: 10000 })
  await page.locator('[data-dsh-widget-board-editor-done]').click()
  await page.waitForSelector('[data-dsh-widget-board-editor]', { state: 'detached', timeout: 10000 })
  const group = `[data-instance="${id}"] [data-dsh-widget-board-flip-group]`
  await page.waitForSelector(group, { timeout: 10000 })
  await page.waitForSelector(`${group} iframe[title="数字"]`, { timeout: 30000 })
  await page.waitForSelector(`${group} iframe[title="图表"]`, { timeout: 30000 })
  const faces = await page.evaluate((selector) => {
    const node = document.querySelector(selector)
    return { faces: node?.querySelectorAll('.dsh-widget-board__flip-face').length ?? 0, frames: node?.querySelectorAll('iframe').length ?? 0 }
  }, group)
  check('翻面组正面与背面各一张卡', faces.faces === 2 && faces.frames === 2, `${faces.faces} 层 / ${faces.frames} 个画面`)

  await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'center' }), group)
  await sleep(300)
  const center = await page.evaluate((selector) => {
    const rect = document.querySelector(selector)?.getBoundingClientRect()
    return rect === undefined ? null : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, group)
  check('翻面组在视口里', center !== null)
  if (center === null) return
  await page.mouse.move(10, 10)
  await sleep(200)
  await page.mouse.move(center.x, center.y)
  await sleep(400)
  const flipped = await page.evaluate((selector) => {
    const node = document.querySelector(selector)
    const inner = node?.querySelector('.dsh-widget-board__flip-inner')
    return node?.getAttribute('data-flipped') === 'true' && inner?.classList.contains('is-flipped') === true
  }, group)
  check('鼠标移上去翻到背面', flipped)
  await page.mouse.move(10, 10)
  await sleep(400)
  const back = await page.evaluate((selector) => document.querySelector(selector)?.getAttribute('data-flipped') !== 'true', group)
  check('鼠标离开翻回正面', back)

  await page.locator(`[data-instance="${id}"] [data-dsh-widget-board-handle="remove"]`).click()
  await page.waitForFunction((count) => document.querySelectorAll('[data-instance]').length === count, before, { timeout: 10000 })
  check('翻面组整组移除', true)
}

module.exports = { groupPass }
