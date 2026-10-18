#!/usr/bin/env node
'use strict'
/**
 * provider.cjs — 插件提供方的冒烟场景（D6、D12、D17）。
 *
 * 核对一个外部插件提供的东西真的能用：组件出现在组件库里、加得到看板上、原生组件拿到数据源的数据、
 * 要权限的数据源与动作在授权前被拦下、组件声明的定时刷新自己往前走、撤下之后卡片能移除。
 *
 * 只查找插件自己写在节点上的标记（`data-dsh-widget-board-*`、`data-test-native-*`），宿主换了内部
 * 结构也不会让这些判据失真（D1）。
 */
const { openLibrary } = require('./library.cjs')

/** 冒烟用的提供方的包名。 */
const PROVIDER = 'dsh-widget-board-test-provider'

/** 它注册的动作：要权限的那一个。 */
const GATED_ACTION = `${PROVIDER}:test.run`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 一次插件提供方的核对。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param check - 记一条判据的函数。
 */
async function providerPass(page, check) {
  // 上一轮跑剩的同款卡片会自己刷新，把计数器推高：先清掉它们，这一轮的判据才从同一个起点开始。
  const leftovers = await page.evaluate(async () => {
    const snapshot = await (await fetch('api/widget-board/board')).json()
    return snapshot.board.instances.filter((instance) => instance.widget === 'test-native').map((instance) => instance.id)
  })
  for (const id of leftovers) {
    await page.evaluate(async (instance) => {
      await fetch(`api/widget-board/instance/${instance}/remove`, { method: 'POST' })
    }, id)
  }

  await openLibrary(page)
  await page.waitForSelector('[data-dsh-widget-board-add="test-native"]', { timeout: 15000 })
  check('插件提供的组件出现在组件库里', true)
  const before = await page.evaluate(() => document.querySelectorAll('[data-dsh-widget-board-view] [data-instance]').length)
  await page.locator('[data-dsh-widget-board-add="test-native"]').click()
  await page.waitForFunction((count) => document.querySelectorAll('[data-dsh-widget-board-view] [data-instance]').length === count + 1, before, { timeout: 15000 })
  // 只看这一次加上的那张卡：组件库里的缩略画面也画着同一个原生组件，看板上可能还有别的同款卡片。
  const id = await page.evaluate((provider) => {
    const cards = Array.from(document.querySelectorAll(`[data-dsh-widget-board-view] [data-native-widget="${provider}"]`))
    return cards.at(-1)?.closest('[data-instance]')?.getAttribute('data-instance') ?? ''
  }, PROVIDER)
  check('插件提供的组件加到了看板上', id !== '')
  const card = `[data-instance="${id}"]`
  // 卡片先加进来、数据随后由宿主读一次再推给卡片：等数字出现再核对（D17）。
  await page.waitForFunction(
    (selector) => (document.querySelector(selector)?.textContent ?? '').trim() !== '',
    `${card} [data-test-native-count]`,
    { timeout: 15000 },
  )
  const count = Number.parseInt((await page.locator(`${card} [data-test-native-count]`).innerText()).trim(), 10)
  // 计数器由数据源每读一次加一：卡片上加起来之前数据是空的，所以这里出现一个数就说明读到了。
  check('原生组件拿到数据源的数据', Number.isInteger(count) && count >= 7, String(count))

  // 要权限的数据源：读它之前要有授权（D6）。
  const gated = await page.evaluate(async (instance) => {
    const response = await fetch(`api/widget-board/instance/${instance}/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'test.gated' }),
    })
    return { status: response.status, body: await response.json() }
  }, id)
  check('要权限的数据源在授权前被拦下', gated.status === 403 && gated.body.code === 'grant-required', `${gated.status} ${JSON.stringify(gated.body).slice(0, 90)}`)

  // 组件声明了每秒刷新（D6）：人没做任何事，数字自己往前走——只有页面开着的时候才走。
  let advanced = false
  try {
    await page.waitForFunction(
      (arg) => Number.parseInt(document.querySelector(arg.selector)?.textContent ?? '0', 10) > arg.from,
      { selector: `${card} [data-test-native-count]`, from: count },
      { timeout: 15000 },
    )
    advanced = true
  } catch {
    advanced = false
  }
  check('声明了定时刷新的卡片自己往前走', advanced)

  // 要权限的动作：先被拦下，授权之后同一个按钮就通了（D6）。冒烟用的是同一个 `DSH_HOME`，
  // 上一轮留下的授权要先撤掉，判据才与「刚装上」一致。
  const strip = `${card} .dsh-widget-board__failure-strip`
  const ask = `${card} [data-dsh-widget-board-grant]`
  const run = `${card} [data-test-native-run]`
  await page.waitForSelector(run, { timeout: 10000 })
  await page.evaluate(async (arg) => {
    await fetch(`api/widget-board/instance/${arg.instance}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'action', id: arg.action }),
    })
  }, { instance: id, action: GATED_ACTION })
  let asked = false
  for (let attempt = 0; attempt < 4 && !asked; attempt += 1) {
    await page.locator(run).click()
    try {
      await page.waitForSelector(ask, { timeout: 4000 })
      asked = true
    } catch {
      await sleep(500)
    }
  }
  check('要权限的动作在授权前被拦下并给出授权入口', asked)
  if (asked) {
    const reason = (await page.locator(strip).innerText()).trim()
    check('拦下时说清了原因', reason.includes('先由人给出授权'), reason)
    await page.locator(ask).click()
    await page.waitForFunction((selector) => document.querySelector(selector) === null, ask, { timeout: 10000 })
    check('在卡片上给出授权之后那一条提示收起', true)
    await page.locator(run).click()
    await sleep(600)
    const left = await page.locator(strip).count()
    check('授权之后同一个动作不再被拦下', left === 0, `${left} 条提示`)
  }

  await page.locator(`${card} [data-dsh-widget-board-handle="remove"]`).click()
  await page.waitForFunction((selector) => document.querySelector(selector) === null, card, { timeout: 10000 })
  check('移除插件提供的卡片', true)
}

module.exports = { providerPass }
