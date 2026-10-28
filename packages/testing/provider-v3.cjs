#!/usr/bin/env node
'use strict'
/**
 * provider-v3.cjs — 新入口（registerProvider）的冒烟场景（D31、D17、D24、D30）。
 *
 * 核对 v3 提供方真的能用：一个把手管两个组件目录与两个原生组件，数据读得到、动作跑得起来、能力调得通；
 * 新把手与旧入口（`fixtures/provider`，固定注册版本 2）在同一台宿主上同时工作；慢数据源上 8 个执行槽
 * 占满时第 9 个立即被拒，占着的那 8 个按 15 秒的默认时限失败，另一个提供方不受影响；设置页的健康表看
 * 得见注册数、超时数与用途；停用之后卡片留着并显示不可用、健康行写着不可用，启用之后回来。
 *
 * 查找只用插件与提供方自己写在节点上的标记（`data-dsh-widget-board-*`、`data-testv3*`、
 * `data-test-native*`），宿主换了内部结构也不会让这些判据失真（D1）。
 */
const { openPage } = require('./dsh-web.cjs')
const { openLibrary } = require('./library.cjs')
const { closeBoardSettings, openBoard, openBoardSettings } = require('./panel.cjs')
const {
  addWidget,
  callCapability,
  readSource,
  removeCard,
  removeCardsOf,
  runAction,
  setProviderEnabled,
} = require('./providing.cjs')

/** 新把手的提供方包名。 */
const V3_PROVIDER = 'dsh-widget-board-test-provider-v3'

/** 旧入口的提供方包名；同一台宿主上两个都装着。 */
const V2_PROVIDER = 'dsh-widget-board-test-provider'

/** 新把手两个组件目录里的组件。 */
const ALPHA = 'testv3.alpha'
const BETA = 'testv3.beta'

/** 旧入口的组件。 */
const NATIVE = 'test-native'

/** 慢数据源的名字。 */
const SLOW = 'testv3.slow'

/** 慢场景里同时在飞的读取数：执行器给每个提供方 8 个槽，第 9 个要被立即拒掉。 */
const BURST = 9

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 设置页健康表里一个提供方那一行。
 *
 * @param page - 宿主页面，设置面板的看板那一节已经打开。
 * @param provider - 提供方包名。
 * @returns 那一行的读数。
 */
async function healthOf(page, provider) {
  await page.waitForSelector(`[data-dsh-widget-board-provider="${provider}"]`, { timeout: 20000 })
  return await page.evaluate((wanted) => {
    const row = document.querySelector(`[data-dsh-widget-board-provider="${wanted}"]`)
    if (row === null) return null
    const numbers = Array.from(row.querySelectorAll('td'))
      .filter((cell) => cell.className.includes('dsh-widget-board__provider-health-number'))
      .map((cell) => Number.parseInt(cell.textContent ?? '', 10))
    return {
      available: row.getAttribute('data-available') === 'true',
      features: Array.from(row.querySelectorAll('code')).map((code) => code.textContent ?? ''),
      registrations: numbers[0],
      failures: numbers[1],
      timeouts: numbers[2],
    }
  }, provider)
}

/**
 * 同一时刻打进 9 个读取。
 *
 * 浏览器对同一个来源只开 6 条连接，一个页面凑不出 9 个同时在飞的请求，所以分给两个页面：两页各自是
 * 一个浏览器进程，各 4 条与 5 条，都在 6 条以内。
 *
 * @param pages - 两个页面。
 * @param instance - 卡片 id。
 * @param source - 数据源名字。
 * @returns 每一条的状态码与总共花掉的时间。
 */
async function burstReads(pages, instance, source) {
  const counts = [4, 5]
  const started = Date.now()
  const answers = await Promise.all(pages.map(async (page, index) => await page.evaluate(async (wanted) => {
    const ask = async () => {
      const response = await fetch(`api/widget-board/instance/${wanted.instance}/read`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: wanted.source }),
      })
      return response.status
    }
    return await Promise.all(Array.from({ length: wanted.count }, ask))
  }, { instance, source, count: counts[index] })))
  return { statuses: answers.flat(), elapsedMs: Date.now() - started }
}

/**
 * 一次 v3 提供方的核对。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param check - 记一条判据的函数。
 * @param options - `url`：临时宿主的地址，慢场景要再开一个页面。
 */
async function providerV3Pass(page, check, options) {
  // 上一轮跑剩的同款卡片会自己刷新，把计数器推高：先清掉它们，这一轮的判据才从同一个起点开始。
  await removeCardsOf(page, [ALPHA, BETA, NATIVE])

  // 一个把手挂的两个目录都进了组件库，旧入口的扁平 id 与它并排可用。
  await openLibrary(page)
  const listed = await page.evaluate((ids) => ids.map((id) => document.querySelector(`[data-dsh-widget-board-add="${id}"]`) !== null), [ALPHA, BETA, NATIVE])
  check('新把手两个组件目录的组件与旧入口的组件一起列在组件库里', listed.every(Boolean), listed.join(' / '))

  const alpha = await addWidget(page, ALPHA)
  const beta = await addWidget(page, BETA)
  const native = await addWidget(page, NATIVE)
  check('新把手的两个组件各加得到一张卡', alpha !== '' && beta !== '', `${alpha} / ${beta}`)
  check('旧入口的组件在同一台宿主上照常加得进来', native !== '', native)
  if (alpha === '' || beta === '' || native === '') return

  const alphaCard = `[data-instance="${alpha}"]`
  // 一个把手上挂的两个原生组件都画在父页面里（D3 的原生级）。
  for (const [widget, id] of [['alpha', alpha], ['beta', beta]]) {
    try {
      await page.waitForSelector(`[data-instance="${id}"] [data-native-widget="${V3_PROVIDER}"] [data-testv3="${widget}"]`, { timeout: 20000 })
    } catch (error) {
      const html = await page.locator(`[data-instance="${id}"]`).evaluate((element) => element.outerHTML).catch(() => '')
      throw new Error(`新把手的原生组件 ${widget} 没有画出来：${html.slice(0, 600)}\n${error.message}`)
    }
  }
  check('一个把手挂上的两个原生组件都画在各自卡片上', true)
  // 卡片加进来、数据随后由宿主读一次再推给卡片：等数字出现再核对（D17）。
  await page.waitForFunction(
    (selector) => (document.querySelector(selector)?.textContent ?? '').trim() !== '',
    `${alphaCard} [data-testv3-count]`,
    { timeout: 20000 },
  )
  check('新把手的数据源把数字送到卡片上', true)

  const counted = await readSource(page, alpha, 'testv3.count')
  check('新把手的数据源读得出来', counted.status === 200 && typeof counted.body.data?.count === 'number', `${counted.status} ${JSON.stringify(counted.body).slice(0, 90)}`)
  const betaCount = await readSource(page, beta, 'testv3.count')
  check('第二个目录的组件也用同一个数据源', betaCount.status === 200 && typeof betaCount.body.data?.count === 'number', `${betaCount.status}`)

  const ran = await runAction(page, alpha, 'testv3.run')
  check('新把手的动作跑得起来', ran.status === 200 && ran.body.result?.ran === true, `${ran.status} ${JSON.stringify(ran.body).slice(0, 90)}`)

  const echoed = await callCapability(page, alpha, 'testv3.echo', { text: 'v3' })
  check('新把手的能力调得通', echoed.status === 200 && echoed.body.result?.echo === 'v3', `${echoed.status} ${JSON.stringify(echoed.body).slice(0, 90)}`)
  const badArgs = await callCapability(page, alpha, 'testv3.echo', { text: 7 })
  check('能力的参数按声明的 schema 拦下', badArgs.status === 400, `${badArgs.status} ${JSON.stringify(badArgs.body).slice(0, 90)}`)

  // 旧入口固定用版本 2：服务自报 3，数据源把当初注册用的版本一起交上来，判据从这一处读。
  const legacy = await readSource(page, native, 'test.count')
  check('旧入口的提供方照常读得到数据', legacy.status === 200 && typeof legacy.body.data?.count === 'number', `${legacy.status} ${JSON.stringify(legacy.body).slice(0, 90)}`)
  check('旧入口固定注册版本 2，与自报 3 的服务并行', legacy.body.data?.apiVersion === 2, `apiVersion=${String(legacy.body.data?.apiVersion)}`)

  // 慢数据源：8 个槽占满，第 9 个立即被拒；占着的那 8 个按默认时限失败。
  const burst = await openPage(options.url)
  let answer
  try {
    // 这一页先把启动令牌换成会话，之后它的读取才不会被 401 拒掉。
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const ready = await burst.page.evaluate(async () => (await fetch('api/widget-board/boards')).ok)
      if (ready) break
      await sleep(500)
    }
    const pending = burstReads([page, burst.page], alpha, SLOW)
    // 槽被占着的这十几秒里，另一个提供方照常读得到——并发与超时是按提供方算的（D31）。
    await sleep(1500)
    const otherSide = await readSource(page, native, 'test.count')
    check('慢数据源占着槽的时候另一个提供方照常读得到', otherSide.status === 200 && typeof otherSide.body.data?.count === 'number', `${otherSide.status} ${JSON.stringify(otherSide.body).slice(0, 90)}`)
    answer = await pending
  } finally {
    await burst.close()
  }
  const timedOut = answer.statuses.filter((status) => status === 504).length
  const rejected = answer.statuses.filter((status) => status === 429).length
  check(
    `慢数据源上 ${BURST} 个并发读取：8 个超时、1 个立即被拒`,
    answer.statuses.length === BURST && timedOut === 8 && rejected === 1,
    `${answer.statuses.join(',')} / ${answer.elapsedMs} 毫秒`,
  )
  check('超时按 15 秒的默认时限算', answer.elapsedMs >= 14000 && answer.elapsedMs < 25000, `${answer.elapsedMs} 毫秒`)

  // 槽在提供方的 promise 真正结束之后才放开：慢数据源 16 秒才答完，等它让出来再往下走。
  let freed = false
  let waited = 0
  while (!freed && waited < 12000) {
    const again = await readSource(page, alpha, 'testv3.count')
    freed = again.status === 200
    if (!freed) {
      await sleep(500)
      waited += 500
    }
  }
  check('慢调用结束之后执行槽放开了', freed, `又等了 ${waited} 毫秒`)

  // 设置页的健康表：注册数、超时数与声明的用途都看得见（D31）。
  await openBoardSettings(page)
  const row = await healthOf(page, V3_PROVIDER)
  check('设置页的健康表列出新把手的提供方', row !== null && row.available === true, JSON.stringify(row))
  check('健康表记下这次注册的各项', row?.registrations === 7, String(row?.registrations))
  check('健康表记下这 8 次超时', (row?.timeouts ?? 0) >= 8, String(row?.timeouts))
  check('健康表写出声明的用途', row?.features.includes('marketProvider') === true && row?.features.includes('capabilityMetadata') === true, (row?.features ?? []).join(','))
  const legacyRow = await healthOf(page, V2_PROVIDER)
  check('旧入口的提供方也在表里，没有声明用途', legacyRow !== null && legacyRow.available === true && legacyRow.features.length === 0, JSON.stringify(legacyRow))
  await closeBoardSettings(page)

  // 停用新把手：组件、数据源、动作与能力一起撤下，卡片留着并显示不可用（D31、D17）。
  await setProviderEnabled(page, V3_PROVIDER, false)
  await openBoard(page)
  await page.waitForSelector(alphaCard, { timeout: 30000 })
  try {
    await page.waitForSelector(`${alphaCard}[data-unavailable="${ALPHA}"]`, { timeout: 30000 })
  } catch (error) {
    const html = await page.locator(alphaCard).evaluate((element) => element.outerHTML).catch(() => '')
    throw new Error(`新把手停用后卡片没有变成不可用：${html.slice(0, 800)}\n${error.message}`)
  }
  check('新把手停用后卡片保留并显示不可用', true)
  check('原生组件从卡片上撤下', await page.locator(`${alphaCard} [data-native-widget="${V3_PROVIDER}"]`).count() === 0)
  const readGone = await readSource(page, alpha, 'testv3.count')
  check('新把手停用后数据源不再解析', readGone.status === 400 && String(readGone.body.error).includes('没有数据源'), `${readGone.status} ${JSON.stringify(readGone.body).slice(0, 90)}`)
  const callGone = await callCapability(page, alpha, 'testv3.echo', { text: 'x' })
  check('新把手停用后能力不再可用', callGone.status === 400 && /没有能力|组件不在组件库里/.test(String(callGone.body.error)), `${callGone.status} ${JSON.stringify(callGone.body).slice(0, 90)}`)

  await openBoardSettings(page)
  const offRow = await healthOf(page, V3_PROVIDER)
  check('停用后健康行写着不可用', offRow !== null && offRow.available === false, JSON.stringify(offRow))
  await closeBoardSettings(page)

  // 启用：注册回来，卡片恢复（D31）。
  await setProviderEnabled(page, V3_PROVIDER, true)
  await openBoard(page)
  await page.waitForSelector(`${alphaCard} [data-native-widget="${V3_PROVIDER}"]`, { timeout: 30000 })
  check('启用后原生组件回到卡片', true)
  const readBack = await readSource(page, alpha, 'testv3.count')
  check('启用后数据源回来', readBack.status === 200 && typeof readBack.body.data?.count === 'number', `${readBack.status} ${JSON.stringify(readBack.body).slice(0, 90)}`)
  const callBack = await callCapability(page, alpha, 'testv3.echo', { text: 'back' })
  check('启用后能力回来', callBack.status === 200 && callBack.body.result?.echo === 'back', `${callBack.status}`)

  await openBoardSettings(page)
  const onRow = await healthOf(page, V3_PROVIDER)
  check('启用后健康行回到可用', onRow !== null && onRow.available === true, JSON.stringify(onRow))
  await closeBoardSettings(page)

  await openBoard(page)
  await removeCard(page, alpha)
  check('移除新把手的卡片', true)
  await removeCardsOf(page, [BETA, NATIVE])
}

module.exports = { providerV3Pass }
