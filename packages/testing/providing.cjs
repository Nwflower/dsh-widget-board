#!/usr/bin/env node
'use strict'
/**
 * providing.cjs — 提供方在真实宿主上的共同动作（D31、D17、D24）。
 *
 * 两个提供方场景（旧入口的 `fixtures/provider` 与新把手的 `fixtures/provider-v3`）要用同一套方式找插件
 * 页、开关一个插件、加一张插件提供的卡片、读一次数据、发一次动作或调一次能力，并清掉上一轮留下的卡片。
 * 这几种写法只留在这里，场景文件只写各自的判据。
 *
 * 查找只用插件自己写在节点上的标记（`data-dsh-widget-board-*`）；插件页那一行按文字找，因为它是宿主
 * 自己的界面，宿主换了内部结构时这一处不跟着改（D1）。
 */
const { openLibrary } = require('./library.cjs')

/** 侧栏里插件页那一行的文字。 */
const PLUGINS_PANEL = '插件'

/** 看板上的一张卡：插件自己的标记。 */
const CARD = '[data-dsh-widget-board-view] [data-instance]'

/**
 * 工作区里的全部卡片。
 *
 * @param page - 宿主页面。
 * @returns `{ id, widget }`，按看板顺序。
 */
async function cardsOfAll(page) {
  return await page.evaluate(async () => {
    const snapshot = await (await fetch('api/widget-board/boards')).json()
    return snapshot.boards.flatMap((board) => board.instances.map((instance) => ({ id: instance.id, widget: instance.widget })))
  })
}

/**
 * 某个组件的全部卡片 id。
 *
 * @param page - 宿主页面。
 * @param widget - 组件 id。
 * @returns 卡片 id。
 */
async function cardsOf(page, widget) {
  return (await cardsOfAll(page)).filter((instance) => instance.widget === widget).map((instance) => instance.id)
}

/**
 * 把几个组件的卡片全移除。
 *
 * 上一轮跑剩的同款卡片会自己刷新，把这一次的判据推离起点，所以每个场景先把自己的那几种清掉。
 *
 * @param page - 宿主页面。
 * @param widgets - 要清掉的组件 id。
 */
async function removeCardsOf(page, widgets) {
  for (const instance of (await cardsOfAll(page)).filter((item) => widgets.includes(item.widget))) {
    await page.evaluate(async (id) => {
      await fetch(`api/widget-board/instance/${id}/remove`, { method: 'POST' })
    }, instance.id)
  }
}

/**
 * 从组件库加一张卡，交回新卡的 id。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param widget - 组件 id。
 * @returns 新卡的 id；没加上时为空串。
 */
async function addWidget(page, widget) {
  const before = await page.evaluate((selector) => Array.from(document.querySelectorAll(selector)).map((node) => node.getAttribute('data-instance')), CARD)
  await openLibrary(page)
  const add = `[data-dsh-widget-board-add="${widget}"]`
  await page.waitForSelector(add, { timeout: 15000 })
  await page.locator(add).click()
  await page.waitForFunction((count) => document.querySelectorAll('[data-dsh-widget-board-view] [data-instance]').length === count + 1, before.length, { timeout: 15000 })
  const after = await page.evaluate((selector) => Array.from(document.querySelectorAll(selector)).map((node) => node.getAttribute('data-instance')), CARD)
  return after.find((id) => !before.includes(id)) ?? ''
}

/**
 * 按卡片上的移除把手删掉一张卡。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param id - 卡片 id。
 */
async function removeCard(page, id) {
  const card = `[data-instance="${id}"]`
  await page.locator(`${card} [data-dsh-widget-board-handle="remove"]`).click()
  await page.waitForFunction((selector) => document.querySelector(selector) === null, card, { timeout: 10000 })
}

/**
 * 打开宿主的插件页。
 *
 * @param page - 宿主页面。
 */
async function openPlugins(page) {
  const clicked = await page.evaluate((label) => {
    const row = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === label)
    if (row === undefined) return false
    row.click()
    return true
  }, PLUGINS_PANEL)
  if (!clicked) throw new Error('侧栏里没有插件入口')
  await page.waitForSelector('[data-plugin-package]', { timeout: 20000 })
}

/**
 * 在插件页打开提供方所在包的详情，交回提供方那一行。
 *
 * @param page - 宿主页面。
 * @param provider - 提供方的包名。
 * @returns 提供方那一行的 locator。
 */
async function openProviderRow(page, provider) {
  await openPlugins(page)
  const rows = page.locator('[data-plugin-row]').filter({ hasText: provider })
  if (await rows.count() === 0) {
    await page.locator(`[data-plugin-package="${provider}"] button[aria-label]`).first().click()
  }
  const row = rows.first()
  await row.waitFor({ timeout: 20000 })
  return row
}

/**
 * 在插件页把提供方那一行开或关；行开关走 `setPluginEnabled`，在在线 profile 上直接生效。
 *
 * @param page - 宿主页面。
 * @param provider - 提供方的包名。
 * @param enabled - 要开还是要关。
 */
async function setProviderEnabled(page, provider, enabled) {
  const row = await openProviderRow(page, provider)
  await row.locator('[role="switch"]').click()
  await page.waitForFunction((wanted) => {
    const found = Array.from(document.querySelectorAll('[data-plugin-row]')).find((candidate) => candidate.textContent?.includes(wanted.provider))
    return found?.querySelector('[role="switch"]')?.getAttribute('aria-checked') === String(wanted.enabled)
  }, { provider, enabled }, { timeout: 30000 })
}

/**
 * 直接读一次卡片的数据源，绕过界面。
 *
 * @param page - 宿主页面。
 * @param instance - 卡片 id。
 * @param source - 数据源名字。
 * @returns 状态码与响应体。
 */
async function readSource(page, instance, source) {
  return await page.evaluate(async (wanted) => {
    const response = await fetch(`api/widget-board/instance/${wanted.instance}/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: wanted.source }),
    })
    return { status: response.status, body: await response.json() }
  }, { instance, source })
}

/**
 * 直接发一次卡片动作，绕过界面。
 *
 * @param page - 宿主页面。
 * @param instance - 卡片 id。
 * @param action - 动作 id。
 * @returns 状态码与响应体。
 */
async function runAction(page, instance, action) {
  return await page.evaluate(async (wanted) => {
    const response = await fetch(`api/widget-board/instance/${wanted.instance}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: wanted.action }),
    })
    return { status: response.status, body: await response.json() }
  }, { instance, action })
}

/**
 * 直接调一次卡片的宿主能力，绕过界面。
 *
 * @param page - 宿主页面。
 * @param instance - 卡片 id。
 * @param capability - 能力名字。
 * @param args - 参数。
 * @returns 状态码与响应体。
 */
async function callCapability(page, instance, capability, args) {
  return await page.evaluate(async (wanted) => {
    const response = await fetch(`api/widget-board/instance/${wanted.instance}/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capability: wanted.capability, args: wanted.args }),
    })
    return { status: response.status, body: await response.json() }
  }, { instance, capability, args })
}

module.exports = {
  addWidget,
  callCapability,
  cardsOf,
  cardsOfAll,
  openPlugins,
  openProviderRow,
  readSource,
  removeCard,
  removeCardsOf,
  runAction,
  setProviderEnabled,
}
