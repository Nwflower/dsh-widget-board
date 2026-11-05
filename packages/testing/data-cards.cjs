#!/usr/bin/env node
'use strict'
/**
 * data-cards.cjs — 两张内置数据卡的真实宿主场景：运行成本与最近 Token 用量。
 *
 * 两卡的共同点是不自己计时：卡片可见期间由宿主按数据源的订阅推数据，离开视口就停（D32）。所以这里的
 * 每一步都先把卡片滚进视口，再看它拿到了什么——折叠下面的卡片本来就不该有读数。
 *
 * 检查的判据：
 * - 运行成本：首份采样同时出现在卡片与工作区快照里、每 5 秒一份新采样、离开视口后停下、回到视口后
 *   重新订阅并出新采样、「再测一次」经按需读拿回一份当下的采样、白名单之外的源被拒绝并在卡片上可见。
 * - 最近 Token 用量：首份快照、会话事件推一份新快照、改 props 的 scope 之后按新窗口重订并出新快照。
 *
 * 临时宿主里没有模型可跑，会话事件由场景生成的宿主插件经宿主自己的会话 API 追加：事件由宿主的
 * session/event 广播，看板的订阅、快照、schema 校验、写入与卡片全是真实那一份，没有替代实现。
 * 插件写在 .debug/ 下，随这次运行用完即弃。
 */
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { workspace } = require('./board.cjs')
const { centerCard, frameOf } = require('./frames.cjs')
const { metricsViewPass } = require('./metrics.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const METRICS_FRAME = 'iframe.dsh-widget-board__frame[title="运行成本"]'
const USAGE_FRAME = 'iframe.dsh-widget-board__frame[title="最近 Token 用量"]'
/** 离开视口时停到的那张卡：它在画廊里排在运行成本之前，滚过去就把运行成本顶出视口。 */
const OTHER_FRAME = '看板题头'
/** 场景注入的会话结算：一眼看得出数字来自哪一条事件。 */
const PROBE = { input: 1234, output: 567, cacheRead: 11, cacheWrite: 3, total: 1801 }

/**
 * 写一份只在这条场景里用的宿主插件：它用宿主自己的会话 API 建一个会话，每两秒追加一轮带用量的结算。
 *
 * 追加走 Session.append，事件因此由宿主自己广播到 session/event：投影、持久化与监听看到的是同一份
 * 真实日志。隔离的临时宿主里没有模型可跑，这是不写假实现的前提下能造出的真实会话事件。
 *
 * @returns 插件的目录，交给 start 的 extras 装进临时宿主。
 */
function prepareCardsProbe() {
  const root = join(__dirname, '..', '..', '.debug', 'data-cards-probe')
  const dir = join(root, 'session-event-probe')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-widget-board-session-event-probe',
    version: '0.0.0',
    private: true,
    description: '数据卡场景用：用宿主自己的会话 API 追加带用量的结算。',
    type: 'module',
    main: 'host.js',
    exports: { '.': './host.js', './package.json': './package.json' },
    dsh: {
      engines: { dsh: '>=0.2.1-rc.1' },
      bundle: { patch: './cordis.patch.yml' },
    },
  }, null, 2) + '\n')
  writeFileSync(join(dir, 'cordis.patch.yml'), [
    '# 数据卡场景用：向 web profile 插一行，随宿主一起启动。',
    '- insert:',
    '    - id: widget-board-session-event-probe',
    "      name: 'dsh-widget-board-session-event-probe'",
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'host.js'), [
    "export const name = 'dsh-widget-board-session-event-probe'",
    "export const inject = ['sessions']",
    '',
    '// 场景按这一段认会话 id 的前 8 位。',
    "const SESSION_ID = 'abcdef01-2345-4678-9abc-def012345678'",
    'const PROBE = { inputTokens: 1234, outputTokens: 567, cacheReadTokens: 11, cacheWriteTokens: 3, totalTokens: 1801 }',
    '',
    'export function apply(ctx) {',
    '  const session = ctx.sessions.create(SESSION_ID)',
    "  const message = (role, text, turn) => ({ id: role + '-' + String(turn), role, content: [{ type: 'text', text }], source: role === 'assistant' ? { kind: 'model', provider: 'probe', model: 'probe' } : { kind: 'user' } })",
    '  let turn = 0',
    '  const cycle = () => {',
    '    turn += 1',
    "    session.append('turn/start', { turn })",
    "    session.append('user/message', message('user', 'probe ' + String(turn), turn), { surfaceOp: 'append' })",
    "    session.append('step/start', { turn, step: 1 })",
    "    if (turn === 1) session.append('request/header', { header: { config: { provider: 'probe', model: 'probe' } }, reason: 'initial' })",
    "    session.append('assistant/message', { turn, step: 1, message: message('assistant', 'probe ' + String(turn), turn), stream: [], usage: PROBE }, { surfaceOp: 'append' })",
    "    session.append('step/end', { turn, step: 1 })",
    "    session.append('turn/end', { turn, reason: { kind: 'completed' } })",
    '  }',
    '  const timer = setInterval(() => {',
    "    try { cycle() } catch (error) { console.error('session-event-probe: ' + (error instanceof Error ? error.message : String(error))) }",
    '  }, 2000)',
    '  timer.unref()',
    '  ctx.effect(() => () => { clearInterval(timer) })',
    '}',
    '',
  ].join('\n'))
  return dir
}

/**
 * 反复读一份东西，直到它满足判据或超时。
 *
 * @param read - 读一次。
 * @param accept - 这一份算不算满足。
 * @param timeoutMs - 最多等多久。
 * @param label - 超时时写进错误里的说法。
 * @returns 最后读到的那一份。
 */
async function poll(read, accept, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await read()
    if (accept(last)) return last
    await sleep(250)
  }
  throw new Error(label + '：' + String(timeoutMs) + ' 毫秒内没有等到，最后读到 ' + JSON.stringify(last))
}

/** 快照里某张内置卡的那一条。 */
async function instanceOf(page, widget) {
  const snapshot = await workspace(page)
  const board = snapshot.boards.find((entry) => entry.id === snapshot.active) ?? snapshot.boards[0]
  return board.instances.find((entry) => entry.widget === widget) ?? null
}

/** 卡片运行时的数据。 */
const dataOf = (frame) => frame.evaluate(() => window.widget?.data ?? null)

/** 运行成本：首份数据、每 5 秒一份、可见性生命周期与按需读。 */
async function metricsPass(page, check) {
  await centerCard(page, '运行成本')
  const frame = await frameOf(page, METRICS_FRAME)
  await metricsViewPass(frame, check)

  const first = await dataOf(frame)
  const instance = await instanceOf(page, 'system-metrics')
  check(
    '运行成本的首份订阅数据同时进了卡片与工作区快照',
    first !== null && typeof first.sampledAt === 'string' && typeof instance?.data?.sampledAt === 'string' &&
      Date.parse(instance.data.sampledAt) >= Date.parse(first.sampledAt) &&
      typeof instance?.data?.host?.rss === 'number' && instance.data.host.rss > 0 &&
      typeof instance.data.system?.platform === 'string' && instance.data.system.platform !== '' &&
      typeof instance.data.board?.documentsBytes === 'number' && instance.data.board.documentsBytes > 0 &&
      typeof instance.data.library?.widgets === 'number' && !Number.isNaN(Date.parse(instance.data.sampledAt)),
    first === null ? '卡片没有数据' : first.sampledAt + ' / rss ' + String(instance?.data?.host?.rss ?? '—'),
  )

  const ticked = await poll(
    () => dataOf(frame),
    (value) => value !== null && typeof value.sampledAt === 'string' && value.sampledAt !== String(first.sampledAt ?? ''),
    12000,
    '运行成本的下一拍采样',
  )
  check('运行成本按 5 秒的节奏拿到新采样', ticked.sampledAt !== first.sampledAt, String(first.sampledAt) + ' → ' + String(ticked.sampledAt))

  await centerCard(page, OTHER_FRAME)
  await sleep(2500)
  const left = await dataOf(frame)
  await sleep(8000)
  const idle = await dataOf(frame)
  check('离开视口之后订阅停下，不再有新采样', left !== null && idle !== null && idle.sampledAt === left.sampledAt, String(left?.sampledAt) + ' → ' + String(idle?.sampledAt))

  await centerCard(page, '运行成本')
  const back = await poll(
    () => dataOf(frame),
    (value) => value !== null && typeof value.sampledAt === 'string' && value.sampledAt !== String(idle?.sampledAt ?? ''),
    12000,
    '回到视口之后的新采样',
  )
  check('回到视口之后重新订阅并出新采样', back.sampledAt !== idle?.sampledAt, String(idle?.sampledAt) + ' → ' + String(back.sampledAt))

  const beforeClick = await frame.evaluate(() => document.querySelector('[data-field="panelMeta"]')?.textContent ?? '')
  await frame.locator('[data-field="again"]').click()
  const settled = await poll(
    () => frame.evaluate(() => ({ label: document.querySelector('[data-field="again"]')?.textContent ?? '', meta: document.querySelector('[data-field="panelMeta"]')?.textContent ?? '', state: document.querySelector('.metrics')?.dataset.state ?? '' })),
    (value) => value.label === '再测一次' && value.meta !== beforeClick,
    10000,
    '再测一次落定',
  )
  check('「再测一次」读回一份采样并画到卡片上', settled.state === 'ready' && settled.meta !== beforeClick, beforeClick + ' → ' + settled.meta)

  const read = await frame.evaluate(async () => {
    const data = await window.widget.call('widget-board:data.read')
    return { sampledAt: data?.sampledAt ?? null, rss: data?.host?.rss ?? null }
  })
  check('按需读把一整套采样交回组件', typeof read.sampledAt === 'string' && typeof read.rss === 'number' && read.rss > 0, String(read.sampledAt) + ' / rss ' + String(read.rss))

  // 白名单之外的源在读取之前就被拒绝：拒绝原样回给组件，再按组件自己的失败路径画到卡片上。
  const refusal = await frame.evaluate(async () => {
    try {
      await window.widget.call('widget-board:data.read', { source: 'probe.not-declared' })
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })
  // 拒绝带着它自己的说法回到组件：外面不再套一层 502 的「调用失败」（D31）。
  check('白名单之外的源在读取之前就被拒绝', typeof refusal === 'string' && refusal.includes('没有声明数据源') && !refusal.includes('调用失败'), String(refusal))
  await frame.evaluate((message) => { window.widget.reportError(message) }, String(refusal))
  const strip = await poll(
    () => page.evaluate(() => Array.from(document.querySelectorAll('.dsh-widget-board__failure-strip')).map((node) => node.textContent ?? '')),
    (list) => list.some((text) => text.includes('没有声明数据源')),
    5000,
    '卡片上的可见失败',
  )
  check('读取失败在卡片上可见', strip.some((text) => text.includes('没有声明数据源')), strip.join(' / '))
}

/**
 * 改一张内置卡的 props：走客户端同一条路由，由宿主决定接不接受。
 *
 * @param page - 宿主页面。
 * @param widget - 组件 id。
 * @param props - 新的整份 props。
 * @returns 宿主的响应状态。
 */
async function saveProps(page, widget, props) {
  return await page.evaluate(async ({ widget: id, next }) => {
    const body = await (await fetch('api/widget-board/boards')).json()
    const board = body.boards.find((entry) => entry.id === body.active) ?? body.boards[0]
    const card = board.instances.find((entry) => entry.widget === id)
    const response = await fetch('api/widget-board/instance/' + encodeURIComponent(card.id) + '/props', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ props: next }),
    })
    return response.status
  }, { widget, next: props })
}

/** 最近 Token 用量：首份快照、会话事件推一份新快照、props 换窗口后重订。 */
async function usagePass(page, check) {
  await centerCard(page, '最近 Token 用量')
  const frame = await frameOf(page, USAGE_FRAME)
  await frame.waitForSelector('.usage[data-state="ready"], .usage[data-state="no-usage"], .usage[data-state="no-sessions"]', { timeout: 30000 })
  const first = await dataOf(frame)
  const instance = await instanceOf(page, 'session-usage')
  check(
    'Token 卡的首份订阅数据同时进了卡片与工作区快照',
    first !== null && first.available === true && first.scope === 'session' && /^\d{4}-\d{2}-\d{2}$/.test(String(first.date)) &&
      instance?.data?.startedAt === first.startedAt && instance.data.scope === 'session',
    first === null ? '卡片没有数据' : first.scope + ' / ' + String(first.date) + ' / ' + String(first.empty ?? 'ready'),
  )

  const pushed = await poll(
    () => dataOf(frame),
    (value) => value !== null && value.totals !== null && value.totals.calls >= 1 &&
      value.totals.input === PROBE.input * value.totals.calls && value.totals.output === PROBE.output * value.totals.calls,
    20000,
    '会话事件推来的用量',
  )
  const stored = await instanceOf(page, 'session-usage')
  check(
    '会话事件推到卡片并写进工作区快照',
    typeof stored?.data?.totals?.calls === 'number' && stored.data.totals.calls >= pushed.totals.calls &&
      stored.data.totals.input === PROBE.input * stored.data.totals.calls &&
      typeof pushed.session === 'string' && /^[0-9a-f]{8}$/.test(pushed.session),
    'calls ' + String(pushed.totals.calls) + ' / input ' + String(pushed.totals.input) + ' / session ' + String(pushed.session),
  )

  const more = await poll(
    () => dataOf(frame),
    (value) => value !== null && value.totals !== null && value.totals.calls > pushed.totals.calls,
    12000,
    '下一条会话事件推来的用量',
  )
  check('再来一条会话事件就再推一份', more.totals.calls > pushed.totals.calls, String(pushed.totals.calls) + ' → ' + String(more.totals.calls) + ' 次调用')

  const switched = await saveProps(page, 'session-usage', { scope: 'today' })
  check('改 props 的 scope 被宿主接受', switched === 200, String(switched))
  const today = await poll(
    () => dataOf(frame),
    (value) => value !== null && value.scope === 'today' && value.history !== null,
    10000,
    '换到今天窗口之后的新快照',
  )
  check('scope 换到 today 之后重订并出新窗口', today.scope === 'today' && today.history !== null && typeof today.history.available === 'boolean', today.scope + ' / history ' + String(today.history?.reason ?? 'available'))

  const back = await saveProps(page, 'session-usage', { scope: 'session' })
  check('scope 换回所选会话被宿主接受', back === 200, String(back))
  const session = await poll(
    () => dataOf(frame),
    (value) => value !== null && value.scope === 'session' && value.history === null,
    10000,
    '换回所选会话之后的新快照',
  )
  check('scope 换回会话之后重订并出新窗口', session.scope === 'session' && session.history === null && /^[0-9a-f]{8}$/.test(String(session.session)), session.scope + ' / session ' + String(session.session))
}

/**
 * 两张内置数据卡的整条场景。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param check - 这一层共用的判定。
 */
async function dataCardsPass(page, check) {
  await metricsPass(page, check)
  await usagePass(page, check)
}

module.exports = { dataCardsPass, prepareCardsProbe }
