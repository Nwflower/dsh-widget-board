#!/usr/bin/env node
'use strict'
/**
 * provider.cjs — 插件提供方的冒烟场景（D6、D31、D17）。
 *
 * 核对一个按 v2 写的插件提供的东西真的能用：组件出现在组件库里、加得到看板上、原生组件拿到数据源的数据、
 * 要权限的数据源与动作在授权前被拦下、组件声明的定时刷新自己往前走、停用插件之后它们从组件库与卡片上撤下、
 * 启用之后回来、撤下之后卡片能移除。
 *
 * 只查找插件自己写在节点上的标记（`data-dsh-widget-board-*`、`data-test-native-*`），宿主换了内部
 * 结构也不会让这些判据失真（D1）；停用与启用走设置页同一个插件开关。找插件页、开关插件、读数据这些动作
 * 与 `provider-v3.cjs` 共用 `providing.cjs`。
 */
const { existsSync } = require('node:fs')
const { readFile } = require('node:fs/promises')
const { join } = require('node:path')
const { openLibrary } = require('./library.cjs')
const { openBoard } = require('./panel.cjs')
const { addWidget, readSource, removeCard, removeCardsOf, runAction, setProviderEnabled } = require('./providing.cjs')

/** 冒烟用的提供方的包名。 */
const PROVIDER = 'dsh-widget-board-test-provider'

/** 它注册的动作：要权限的那一个。 */
const GATED_ACTION = `${PROVIDER}:test.run`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 冒烟用的提供方注册的组件 id。 */
const WIDGET = 'test-native'

/**
 * 一次插件提供方的核对。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param check - 记一条判据的函数。
 * @param home - 临时 `$DSH_HOME`，用来读提供方留下的授权。
 */
async function providerPass(page, check, home) {
  // 上一轮跑剩的同款卡片会自己刷新，把计数器推高：先清掉它们，这一轮的判据才从同一个起点开始。
  await removeCardsOf(page, [WIDGET])

  await openLibrary(page)
  await page.waitForSelector(`[data-dsh-widget-board-add="${WIDGET}"]`, { timeout: 15000 })
  check('插件提供的组件出现在组件库里', true)
  const id = await addWidget(page, WIDGET)
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
  // 注册用的版本固定是 2：服务自报 3，这一条证明按 v2 写的提供方照常可用（D31）。
  const legacy = await readSource(page, id, 'test.count')
  check('旧入口按版本 2 注册，与自报 3 的服务并行', legacy.status === 200 && legacy.body.data?.apiVersion === 2, `apiVersion=${String(legacy.body.data?.apiVersion)}`)

  // 要权限的数据源：读它之前要有授权（D6）。
  const gated = await readSource(page, id, 'test.gated')
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

  // 要权限的动作：先被拦下，授权之后同一个按钮就通了（D6）。冒烟每轮用临时 `DSH_HOME`；先撤一次
  // 只是兜底，别让同一轮里前面的检查留下的授权让判据偏离「刚装上」。
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

  // 停用提供方：组件、数据源、动作与授权一起撤下；卡片留着并显示不可用（D31、D17）。
  await setProviderEnabled(page, PROVIDER, false)
  await openBoard(page)
  await page.waitForSelector(card, { timeout: 30000 })
  try {
    await page.waitForSelector(`${card}[data-unavailable="${WIDGET}"]`, { timeout: 30000 })
  } catch (error) {
    const html = await page.locator(card).evaluate((element) => element.outerHTML).catch(() => '')
    throw new Error(`提供方停用后卡片没有变成不可用：${html.slice(0, 800)}\n${error.message}`)
  }
  check('提供方停用后卡片保留并显示不可用', true)
  check('原生组件从卡片上撤下', await page.locator(`${card} [data-native-widget="${PROVIDER}"]`).count() === 0)
  const readGone = await readSource(page, id, 'test.count')
  check('提供方停用后数据源不再解析', readGone.status === 400 && String(readGone.body.error).includes('没有数据源'), `${readGone.status} ${JSON.stringify(readGone.body).slice(0, 90)}`)
  const actionGone = await runAction(page, id, GATED_ACTION)
  check('提供方停用后动作不再解析', actionGone.status === 400 && /没有(?:声明)?动作/.test(String(actionGone.body.error)), `${actionGone.status} ${JSON.stringify(actionGone.body).slice(0, 90)}`)
  const grantsFile = join(home, 'widget-board', 'grants.json')
  let grantsGone = false
  for (let attempt = 0; attempt < 20 && !grantsGone; attempt += 1) {
    const stored = existsSync(grantsFile) ? JSON.parse(await readFile(grantsFile, 'utf8')) : { grants: [] }
    grantsGone = !(stored.grants ?? []).some((grant) => grant.provider === PROVIDER)
    if (!grantsGone) await sleep(250)
  }
  check('提供方停用后它留下的授权被清掉', grantsGone)

  // 启用提供方：三样注册回来，卡片恢复（D31）。
  await setProviderEnabled(page, PROVIDER, true)
  await openBoard(page)
  await page.waitForSelector(`${card} [data-native-widget="${PROVIDER}"]`, { timeout: 30000 })
  check('启用后原生组件回到卡片', true)
  const readBack = await readSource(page, id, 'test.count')
  check('启用后数据源回来', readBack.status === 200 && typeof readBack.body.data?.count === 'number', `${readBack.status} ${JSON.stringify(readBack.body).slice(0, 90)}`)
  const actionBack = await runAction(page, id, GATED_ACTION)
  check('启用后动作回来并重新要求授权', actionBack.status === 403, `${actionBack.status} ${JSON.stringify(actionBack.body).slice(0, 90)}`)

  await removeCard(page, id)
  check('移除插件提供的卡片', true)
}

module.exports = { providerPass }
