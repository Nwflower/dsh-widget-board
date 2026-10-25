#!/usr/bin/env node
'use strict'
/**
 * editor.cjs — 卡片设置弹窗的真实宿主检查（D27）。
 *
 * 单卡：三节（配置、日志、关于），在配置一节改字段，保存后宿主的 props 跟着换；日志一节打得开，
 * 绑了数据源的卡片在里面看得到自己发出的请求。有未保存修改时关闭先确认。组卡：槽条有两个槽，
 * 换一个槽的组件，另一个不动，关闭之后两面各自重挂。
 *
 * 只查找插件自己写在节点上的标记（`data-dsh-widget-board-*`），宿主换了内部结构也不会让判据失真。
 */
const { openLibrary } = require('./library.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 等一个条件成立；超时返回 false，让判据自己记下失败而不把整趟冒烟打断。
 *
 * @param probe - 返回布尔值的异步函数。
 * @param timeout - 最长等多久。
 * @returns 成立时为 true。
 */
async function waitFor(probe, timeout = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await probe()) return true
    await sleep(150)
  }
  return false
}

/**
 * 弹窗的矩形是不是整个落在看板页里。
 *
 * @param page - 宿主页面。
 * @returns 落在里面时为 true。
 */
async function editorInsideBoard(page) {
  return await page.evaluate(() => {
    const editor = document.querySelector('[data-dsh-widget-board-editor]')?.getBoundingClientRect()
    const board = document.querySelector('.dsh-widget-board')?.getBoundingClientRect()
    if (editor === undefined || board === undefined) return false
    return editor.left >= board.left && editor.right <= board.right + 1
      && editor.top >= board.top && editor.bottom <= board.bottom + 1
  })
}

/**
 * 读活动看板上某张卡的 props。
 *
 * @param page - 宿主页面。
 * @param id - 卡片实例 id。
 * @returns props。
 */
async function propsOf(page, id) {
  return await page.evaluate(async (instance) => {
    const snapshot = await (await fetch('api/widget-board/boards')).json()
    return snapshot.boards.flatMap((board) => board.instances).find((candidate) => candidate.id === instance)?.props ?? null
  }, id)
}

/**
 * 单卡设置与组卡换槽走一遍。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param check - 记一条判据的函数。
 */
async function editorPass(page, check) {
  // 找一张活动看板上带 kicker/title/meta 的普通卡片（D7）：设置按钮只在挂载着的看板上点得动。
  const id = await page.evaluate(async () => {
    const snapshot = await (await fetch('api/widget-board/boards')).json()
    const active = snapshot.boards.find((board) => board.id === snapshot.active)
    const withTitle = (board) => (board?.instances ?? [])
      .find((instance) => instance.group === undefined && instance.widget === 'clock')?.id
    return withTitle(active) ?? ''
  })
  check('看板上有一张可以设置的普通卡', id !== '')
  if (id === '') return
  const card = `[data-instance="${id}"]`

  await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'center' }), card)
  await sleep(200)
  await page.locator(card).hover()
  await page.locator(`${card} [data-dsh-widget-board-handle="settings"]`).click()
  await page.waitForSelector('[data-dsh-widget-board-editor]', { timeout: 10000 })
  check('设置按钮打开卡片设置弹窗', true)
  check('弹窗落在看板页里', await editorInsideBoard(page))
  const tabs = await page.locator('[data-dsh-widget-board-editor] [data-dsh-widget-board-tab]').count()
  check('单卡有三节设置', tabs === 3, String(tabs))
  const order = await page.locator('[data-dsh-widget-board-editor] [data-dsh-widget-board-tab]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-dsh-widget-board-tab')))
  check('三节的次序是配置、日志、关于', order.join(',') === 'config,log,about', order.join(','))

  // 用带时间戳的时区名：同一份临时 home 上一次冒烟留下的值不会让填写变成一次空操作。
  const zoneText = `Asia/Tokyo+${String(Date.now())}`
  const zone = page.locator('[data-dsh-widget-board-field="zone"]').first()
  await zone.waitFor({ timeout: 10000 })
  await zone.fill(zoneText)
  await page.locator('[data-dsh-widget-board-config-save]').click()
  const savedProps = await waitFor(async () => {
    const props = await propsOf(page, id)
    return props?.zone === zoneText
  })
  check('配置一节把字段存到宿主', savedProps)
  await page.locator('[data-dsh-widget-board-tab="log"]').click()
  await page.waitForSelector('[data-dsh-widget-board-log]', { timeout: 10000 })
  check('日志一节打得开', true)
  await page.locator('[data-dsh-widget-board-tab="config"]').click()

  // 有未保存修改时关闭先确认；确认之后宿主上的值不变。
  await zone.fill('不保存')
  await page.locator('[data-dsh-widget-board-editor-done]').click()
  await page.waitForSelector('[data-dsh-widget-board-editor-keep]', { timeout: 10000 })
  check('有未保存修改时关闭先确认', true)
  await page.locator('[data-dsh-widget-board-editor-keep]').click()
  check('可以回到弹窗继续编辑', await page.locator('[data-dsh-widget-board-editor]').count() === 1)
  await page.locator('[data-dsh-widget-board-editor-done]').click()
  await page.locator('[data-dsh-widget-board-editor-discard]').click()
  await page.waitForSelector('[data-dsh-widget-board-editor]', { state: 'detached', timeout: 10000 })
  const afterDiscard = await propsOf(page, id)
  check('放弃修改不会写宿主', afterDiscard?.zone === zoneText, JSON.stringify(afterDiscard))

  // 天气卡绑了数据源：它的日志里应该看得到刚发出的请求。
  const weatherId = await page.evaluate(async () => {
    const snapshot = await (await fetch('api/widget-board/boards')).json()
    const active = snapshot.boards.find((board) => board.id === snapshot.active)
    return (active?.instances ?? []).find((instance) => instance.widget === 'weather')?.id ?? ''
  })
  if (weatherId !== '') {
    const weatherCard = `[data-instance="${weatherId}"]`
    await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'center' }), weatherCard)
    await page.locator(weatherCard).hover()
    await page.locator(`${weatherCard} [data-dsh-widget-board-handle="settings"]`).click()
    await page.waitForSelector('[data-dsh-widget-board-editor]', { timeout: 10000 })
    await page.locator('[data-dsh-widget-board-tab="log"]').click()
    await page.waitForSelector('[data-dsh-widget-board-log]', { timeout: 10000 })
    await sleep(400)
    const rows = await page.locator('[data-dsh-widget-board-log-row]').count()
    check('日志里看得到这张卡发出的请求', rows > 0, String(rows))
    await page.locator('[data-dsh-widget-board-editor-done]').click()
    await page.waitForSelector('[data-dsh-widget-board-editor]', { state: 'detached', timeout: 10000 })
  }

  // 组卡：加一组，弹窗直接打开；槽条有两个槽，换掉正面那个。
  const before = await page.evaluate(() => document.querySelectorAll('[data-instance]').length)
  await openLibrary(page)
  await page.locator('[data-dsh-widget-board-add="flip-group"]:visible').first().click()
  await page.waitForSelector('[data-dsh-widget-board-editor]', { timeout: 15000 })
  await page.waitForSelector('[data-dsh-widget-board-slot="front"]', { timeout: 10000 })
  const groupId = await page.evaluate(() => Array.from(document.querySelectorAll('[data-instance]')).at(-1)?.getAttribute('data-instance') ?? '')
  check('加组之后直接打开槽条', groupId !== '')
  const slots = await page.locator('[data-dsh-widget-board-slot]').count()
  check('组卡有两个槽', slots === 2, String(slots))
  await page.locator('[data-dsh-widget-board-slot-change]').click()
  // 槽条的组件库按「挑选」模式打开，与常驻组件库的同名按钮并存，按模式取这一处。
  await page.waitForSelector('[data-dsh-widget-board-add="todo"][data-mode="pick"]', { timeout: 10000 })
  await page.locator('[data-dsh-widget-board-add="todo"][data-mode="pick"]').click()
  await page.waitForSelector('[data-dsh-widget-board-slot-confirm]', { timeout: 10000 })
  await page.locator('[data-dsh-widget-board-slot-confirm]').click()
  const changed = await waitFor(async () => {
    const text = await page.locator('[data-dsh-widget-board-slot="front"]').innerText().catch(() => '')
    return text.includes('待办')
  })
  check('换槽之后正面换成待办', changed)
  await page.locator('[data-dsh-widget-board-editor-done]').click()
  await page.waitForSelector('[data-dsh-widget-board-editor]', { state: 'detached', timeout: 10000 })

  const group = `[data-instance="${groupId}"]`
  await page.waitForSelector(`${group} iframe[title="待办"]`, { timeout: 30000 }).catch(() => null)
  const front = await page.locator(`${group} iframe[title="待办"]`).count()
  const back = await page.locator(`${group} iframe[title="今日运势"]`).count()
  check('组卡正面重挂成待办', front === 1)
  check('组卡背面仍是今日运势', back === 1)

  await page.locator(`${group} [data-dsh-widget-board-handle="remove"]`).click()
  await page.waitForFunction((count) => document.querySelectorAll('[data-instance]').length === count, before, { timeout: 10000 })
  check('换过槽的组仍然整组移除', true)
}

module.exports = { editorPass }
