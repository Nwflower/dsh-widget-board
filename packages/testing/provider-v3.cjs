#!/usr/bin/env node
'use strict'
/**
 * provider-v3.cjs — 新入口（registerProvider）的冒烟场景（D31、D17、D24、D30、D32）。
 *
 * 一个把手管两个组件目录：第一个目录的组件甲画成原生，第二个目录的组件乙画成沙箱。两者声明同一份
 * 能力面与数据源白名单，暴露同一套可观察标记（`data-testv3*`），场景按同一份判据对两种写法取证：init
 * 的能力面、按需读 `widget-board:data.read` 的默认源/白名单源/未声明源/授权前后/schema 不符、订阅
 * 的数据推送与生命周期（可见时订上、动作触发推送、离开视口退订、回来重订），以及既有的注册、撤下、
 * 版本、执行槽与健康检查。
 *
 * 订阅账本由提供方按卡片记数（订阅、退订、推送各加一），经动作 `testv3.probe` 读出来：生命周期按
 * 计数判，不按时间猜。查找只用插件与提供方自己写在节点上的标记（D1）。
 */
const { openPage } = require('./dsh-web.cjs')
const { openLibrary } = require('./library.cjs')
const { writeLayouts } = require('./board.cjs')
const { frameOf } = require('./frames.cjs')
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

/** 新把手两个组件目录里的组件：甲走原生，乙走沙箱。 */
const ALPHA = 'testv3.alpha'
const BETA = 'testv3.beta'

/** 两种写法在场景里的名字。 */
const NATIVE = 'native'
const SANDBOX = 'sandbox'

/** 旧入口的组件。 */
const LEGACY = 'test-native'

/** 慢数据源的名字。 */
const SLOW = 'testv3.slow'

/** 慢场景里同时在飞的读取数：执行器给每个提供方 8 个槽，第 9 个要被立即拒掉。 */
const BURST = 9

/** 两张卡声明的能力面（manifest 的 `capabilities`）：前两项可用，第三项没有提供方。 */
const DECLARED = ['testv3.echo', 'widget-board:data.read', 'testv3.gone']

/** 宿主当下解析得到的那些，旧字段 `capabilities` 与它的内容一致（D32）。 */
const AVAILABLE = '["testv3.echo","widget-board:data.read"]'

/** 订阅初值与动作推送的基数，与提供方那一侧同一份约定。 */
const SUBSCRIBE_BASE = 1000
const PUSH_BASE = 2000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 一张卡片。 */
function cardOf(instance) {
  return `[data-instance="${instance}"]`
}

/** 可观察表面的根：原生在父页面里，沙箱在它自己的文档里。 */
function rootOf(kind) {
  return kind === NATIVE ? '[data-testv3="alpha"]' : '[data-testv3="beta"]'
}

/** 在页面或卡片的文档里读一次可观察表面；这个函数会被序列化进去，只引用参数。 */
function surfaceRead(rootSelector) {
  const root = document.querySelector(rootSelector)
  if (root === null) return null
  const text = (selector) => root.querySelector(selector)?.textContent ?? ''
  const read = {}
  for (const slot of ['default', 'extra', 'gated', 'bad', 'undeclared']) read[slot] = text(`[data-testv3-read="${slot}"]`)
  return {
    lang: root.getAttribute('data-testv3-lang') ?? '',
    capabilities: root.getAttribute('data-testv3-capabilities') ?? '',
    metadata: root.getAttribute('data-testv3-metadata') ?? '',
    paused: root.getAttribute('data-testv3-paused') ?? '',
    count: text('[data-testv3-count]'),
    state: text('[data-testv3-state]'),
    echo: text('[data-testv3-echo-result]'),
    gone: text('[data-testv3-gone-result]'),
    read,
  }
}

/** 一张卡的可观察表面：原生画在父页面里，沙箱画在它自己的 iframe 里。 */
async function surfaceOf(page, instance, kind) {
  if (kind === SANDBOX) {
    const frame = await frameOf(page, `${cardOf(instance)} iframe.dsh-widget-board__frame`)
    return await frame.evaluate(surfaceRead, rootOf(kind))
  }
  return await page.evaluate(surfaceRead, `${cardOf(instance)} ${rootOf(kind)}`)
}

/** 等表面上的某一项变成预期；判定本身在页面里做。 */
function surfaceWait(spec) {
  const root = document.querySelector(spec.root)
  if (root === null) return false
  if (spec.attr !== undefined) return root.getAttribute(spec.attr[0]) === spec.attr[1]
  if (spec.text !== undefined) return (root.querySelector(spec.text[0])?.textContent ?? '') === spec.text[1]
  if (spec.prefix !== undefined) return (root.querySelector(spec.prefix[0])?.textContent ?? '').startsWith(spec.prefix[1])
  if (spec.range !== undefined) {
    const raw = root.querySelector(spec.range[0])?.textContent ?? ''
    const value = Number(raw)
    return raw !== '' && Number.isFinite(value) && value >= spec.range[1] && value <= spec.range[2]
  }
  return false
}

/** 等一张卡的表面满足条件，超时的时候把当时的读数一起交出来。 */
async function waitSurface(page, instance, kind, spec, label) {
  const wanted = { ...spec, root: kind === SANDBOX ? rootOf(kind) : `${cardOf(instance)} ${rootOf(kind)}` }
  try {
    if (kind === SANDBOX) {
      const frame = await frameOf(page, `${cardOf(instance)} iframe.dsh-widget-board__frame`)
      await frame.waitForFunction(surfaceWait, wanted, { timeout: 20000, polling: 100 })
    } else {
      await page.waitForFunction(surfaceWait, wanted, { timeout: 20000, polling: 100 })
    }
  } catch (error) {
    const now = await surfaceOf(page, instance, kind).catch(() => null)
    throw new Error(`${label}：表面没有变成 ${JSON.stringify(spec)}，现在是 ${JSON.stringify(now)}\n${error.message}`)
  }
}

/** 按一次表面上的按钮：沙箱的按钮在它自己的文档里。 */
async function clickSurface(page, instance, kind, selector, label) {
  try {
    if (kind === SANDBOX) {
      const frame = await frameOf(page, `${cardOf(instance)} iframe.dsh-widget-board__frame`)
      await frame.locator(selector).click({ timeout: 15000 })
      return
    }
    await page.locator(`${cardOf(instance)} ${selector}`).click({ timeout: 15000 })
  } catch (error) {
    const now = await surfaceOf(page, instance, kind).catch(() => null)
    throw new Error(`${label}：按不到 ${selector}，表面现在是 ${JSON.stringify(now)}\n${error.message}`)
  }
}

/** 读一次订阅账本；读不到时把这一次的响应写进错误里。 */
async function probeOf(page, instance) {
  const answer = await runAction(page, instance, 'testv3.probe')
  if (answer.status !== 200) throw new Error(`读订阅账本失败：${answer.status} ${JSON.stringify(answer.body).slice(0, 160)}`)
  return answer.body.result
}

/** 在页面里读一次订阅账本并比对条件；条件用普通对象写，等的是计数，不是时间。 */
function probeWait(spec) {
  return fetch(`api/widget-board/instance/${spec.instance}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'testv3.probe' }),
  }).then(async (response) => {
    if (!response.ok) return false
    const body = await response.json()
    const book = body.result ?? {}
    for (const key of Object.keys(spec.want.equals ?? {})) {
      if (book[key] !== spec.want.equals[key]) return false
    }
    for (const key of Object.keys(spec.want.atLeast ?? {})) {
      if (!(book[key] >= spec.want.atLeast[key])) return false
    }
    return true
  }, () => false)
}

/** 等一张卡的订阅账本满足条件，交回满足时的账本。 */
async function waitProbe(page, instance, want, label) {
  try {
    await page.waitForFunction(probeWait, { instance, want }, { timeout: 20000, polling: 200 })
  } catch (error) {
    const now = await probeOf(page, instance).catch((failure) => ({ error: String(failure) }))
    throw new Error(`${label}：${instance} 的订阅账本没有到 ${JSON.stringify(want)}，现在是 ${JSON.stringify(now)}\n${error.message}`)
  }
  return await probeOf(page, instance)
}

/** 订阅初值推到卡片上的那个数：第几次订阅就推哪个数。 */
function subscribeCount(book) {
  return String(SUBSCRIBE_BASE + book.subscribes)
}

/** 动作推送推到卡片上的那个数。 */
function pushCount(book) {
  return String(PUSH_BASE + book.pushes)
}

/** 快照里一张卡现在存着什么。 */
async function cardStateOf(page, instance) {
  return await page.evaluate(async (id) => {
    const snapshot = await (await fetch('api/widget-board/boards')).json()
    for (const board of snapshot.boards) {
      const found = board.instances.find((candidate) => candidate.id === id)
      if (found !== undefined) return { widget: found.widget, data: found.data, state: found.state, source: found.source }
    }
    return null
  }, instance)
}

/** 给一张卡的一份源授权，或把它收回。 */
async function setGrant(page, instance, granted) {
  return await page.evaluate(async ({ id, granted }) => {
    const response = await fetch(`api/widget-board/instance/${id}/${granted ? 'grant' : 'revoke'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'source', id: 'testv3.gated' }),
    })
    return { status: response.status, body: await response.json() }
  }, { id: instance, granted })
}

/** 把两张卡摆到同一排、彼此相邻：落点在所有卡片下方，没有别的卡把它们挤开。 */
async function stackCards(page, instances) {
  let slot = 0
  await writeLayouts(page, (cards) => {
    const bottom = Math.max(0, ...cards.map((card) => card.layout.y + card.layout.h))
    slot = Math.ceil((bottom + 2) / 2) * 2
    const layouts = {}
    for (const card of cards) {
      const order = instances.indexOf(card.id)
      layouts[card.id] = order === -1 ? card.layout : { x: order, y: slot, w: 1, h: 22 }
    }
    return layouts
  })
  return slot
}

/** 把两张卡挪到一块布局之外（远在下面的行），可见性上报会把它们从可见集合里去掉。 */
async function moveCards(page, instances, y) {
  await writeLayouts(page, (cards) => {
    const layouts = {}
    for (const card of cards) {
      layouts[card.id] = instances.includes(card.id) ? { ...card.layout, y } : card.layout
    }
    return layouts
  })
}

/** 两张卡是不是已经落在同一排、并且都排完了：布局写入是异步应用的，滚动之前先等它落定。 */
function sameRowWait(spec) {
  const first = document.querySelector(spec.first)
  const second = document.querySelector(spec.second)
  if (first === null || second === null) return false
  const a = first.getBoundingClientRect()
  const b = second.getBoundingClientRect()
  return a.height > 60 && b.height > 60 && Math.abs(a.top - b.top) <= 2 && Math.abs(a.left - b.left) > 2
}

/** 等两张卡摆到同一排；等不到时把当时的矩形交出来。 */
async function settleRow(page, alpha, beta) {
  const spec = { first: cardOf(alpha), second: cardOf(beta) }
  try {
    await page.waitForFunction(sameRowWait, spec, { timeout: 20000, polling: 100 })
  } catch (error) {
    const rects = await page.evaluate((wanted) => {
      const shell = document.querySelector('[data-dsh-widget-board-view]')
      const box = (selector) => {
        const node = document.querySelector(selector)
        if (node === null) return null
        const rect = node.getBoundingClientRect()
        return { top: Math.round(rect.top), left: Math.round(rect.left), height: Math.round(rect.height) }
      }
      return {
        first: box(wanted.first),
        second: box(wanted.second),
        scrollTop: shell === null ? null : Math.round(shell.scrollTop),
      }
    }, spec)
    throw new Error(`两张卡没有摆到同一排：${JSON.stringify(rects)}\n${error.message}`)
  }
}

/**
 * 把两张卡一起滚进看板的可视区：每一拍按实际矩形校一次滚动位置，两张都在容器里就停。
 *
 * 布局刚写入时卡片位置还在变，一次 scrollIntoView 会落在旧位置上；每一拍按当时的矩形校正一次。
 */
async function revealCards(page, alpha, beta) {
  const selectors = [cardOf(alpha), cardOf(beta)]
  try {
    await page.waitForFunction((wanted) => {
      const shell = document.querySelector('[data-dsh-widget-board-view]')
      if (shell === null) return false
      const box = shell.getBoundingClientRect()
      const rects = wanted.map((selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null)
      if (rects.some((rect) => rect === null)) return false
      if (rects.every((rect) => rect.top >= box.top && rect.bottom <= box.bottom)) return true
      const top = Math.min(...rects.map((rect) => rect.top))
      const bottom = Math.max(...rects.map((rect) => rect.bottom))
      // 两张卡的并集中线落到容器中线上；下一拍再量，布局还没应用时下一拍会再校一次。
      shell.scrollTop += Math.round((top + bottom) / 2 - (box.top + box.bottom) / 2)
      return false
    }, selectors, { timeout: 20000, polling: 100 })
  } catch (error) {
    const now = await page.evaluate((wanted) => wanted.map((selector) => {
      const node = document.querySelector(selector)
      const shell = document.querySelector('[data-dsh-widget-board-view]')
      if (node === null || shell === null) return { selector, missing: true }
      const rect = node.getBoundingClientRect()
      const box = shell.getBoundingClientRect()
      return { selector, top: Math.round(rect.top), bottom: Math.round(rect.bottom), shellTop: Math.round(box.top), shellBottom: Math.round(box.bottom) }
    }), selectors)
    throw new Error(`两张卡没有一起落进可视区：${JSON.stringify(now)}\n${error.message}`)
  }
}

/** 收起组件库面板：它盖住卡片时点不到卡片里的按钮。 */
async function closeLibrary(page) {
  const close = page.locator('.dsh-widget-board__library-close')
  if (await close.count() === 0) return
  await close.click()
  await page.waitForSelector('[data-dsh-widget-board-library][data-open="false"]', { timeout: 10000 })
}

/** 两个 JSON 值按键序无关的方式比较。 */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value !== null && typeof value === 'object') {
    const sorted = {}
    for (const key of Object.keys(value).sort()) sorted[key] = stable(value[key])
    return sorted
  }
  return value
}

/** 两个 JSON 值内容相同（键序无关）为真。 */
function sameJson(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right))
}

/** 设置页健康表里一个提供方那一行；设置面板的看板那一节已经打开。 */
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
 * 同一时刻打进 9 个读取：浏览器对同一个来源只开 6 条连接，分给两个页面各 4 条与 5 条。
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

/** init 的能力面：旧字段与元数据两份都由 manifest 的声明投影出来，两种写法拿到同一份（D32）。 */
async function capabilityFacePass(page, check, alpha, beta) {
  const native = await surfaceOf(page, alpha, NATIVE)
  const sandbox = await surfaceOf(page, beta, SANDBOX)
  const nativeMeta = JSON.parse(native.metadata)
  const sandboxMeta = JSON.parse(sandbox.metadata)

  check('init 的 capabilities 仍是可用能力的字符串数组', native.capabilities === AVAILABLE, native.capabilities)
  check('原生与沙箱拿到同一份可用能力名', sandbox.capabilities === native.capabilities, sandbox.capabilities)
  check(
    'capabilityMetadata 按 manifest 的声明次序给全三项',
    nativeMeta.map((item) => item.id).join(',') === DECLARED.join(','),
    nativeMeta.map((item) => item.id).join(','),
  )
  const echo = nativeMeta[0] ?? {}
  check(
    '可用项带着注册项的标题、说明与参数/结果 schema',
    echo.available === true && echo.provider === V3_PROVIDER && echo.title?.zh === '回声'
      && typeof echo.description?.en === 'string' && echo.input?.type === 'object' && echo.output?.required?.[0] === 'echo',
    JSON.stringify(echo).slice(0, 220),
  )
  const read = nativeMeta[1] ?? {}
  check(
    '宿主自己的按需读能力也按注册项给出',
    read.available === true && read.provider === 'widget-board' && read.input?.properties?.source?.type === 'string',
    JSON.stringify(read).slice(0, 220),
  )
  const gone = nativeMeta[2] ?? {}
  check(
    '不可用项只留 id 与 available:false',
    gone.id === 'testv3.gone' && gone.available === false && gone.title === undefined && gone.input === undefined,
    JSON.stringify(gone),
  )
  check('原生与沙箱的能力元数据逐项相同', sameJson(nativeMeta, sandboxMeta), JSON.stringify(sandboxMeta).slice(0, 220))
  check('lang 在两种写法上都能观察到，且是同一个值', native.lang !== '' && sandbox.lang === native.lang, `${native.lang} / ${sandbox.lang}`)
  return { native, sandbox }
}

/** 按需读 `widget-board:data.read`：默认源、白名单源、未声明源、授权前后与 schema 不符（D32）。 */
async function dataReadPass(page, check, alpha, beta) {
  const sides = [[alpha, NATIVE], [beta, SANDBOX]]

  for (const [instance, kind] of sides) {
    const tag = kind === NATIVE ? '原生卡' : '沙箱卡'
    await clickSurface(page, instance, kind, '[data-testv3-read-button="default"]', `${tag}按需读默认源`)
    await waitSurface(page, instance, kind, { prefix: ['[data-testv3-read="default"]', 'ok:'] }, `${tag}按需读默认源的结果`)
    const surface = await surfaceOf(page, instance, kind)
    const parsed = JSON.parse(surface.read.default.slice(3))
    check(`${tag}按需读默认源读得到数据`, typeof parsed.count === 'number' && parsed.from === 'default', surface.read.default)

    await clickSurface(page, instance, kind, '[data-testv3-read-button="extra"]', `${tag}读白名单里的额外源`)
    await waitSurface(page, instance, kind, { prefix: ['[data-testv3-read="extra"]', 'ok:'] }, `${tag}读白名单源的结果`)
    const extra = await surfaceOf(page, instance, kind)
    check(`${tag}读白名单里的额外源`, extra.read.extra === `ok:${JSON.stringify({ count: 7001, from: 'extra' })}`, extra.read.extra)

    await clickSurface(page, instance, kind, '[data-testv3-read-button="undeclared"]', `${tag}读未声明的源`)
    await waitSurface(page, instance, kind, { prefix: ['[data-testv3-read="undeclared"]', 'error:'] }, `${tag}读未声明源的结果`)
    const undeclared = await surfaceOf(page, instance, kind)
    check(
      `${tag}读未声明的源被拒绝，原因可见`,
      undeclared.read.undeclared.includes('组件没有声明数据源 testv3.hidden'),
      undeclared.read.undeclared,
    )

    const revoked = await setGrant(page, instance, false)
    await clickSurface(page, instance, kind, '[data-testv3-read-button="gated"]', `${tag}读要授权的源`)
    await waitSurface(page, instance, kind, { prefix: ['[data-testv3-read="gated"]', 'error:'] }, `${tag}未授权时的结果`)
    const gated = await surfaceOf(page, instance, kind)
    check(
      `${tag}没有授权时读要授权的源被拒`,
      revoked.status === 200 && gated.read.gated.includes('先由人给出授权'),
      `${revoked.status} ${gated.read.gated}`,
    )
    const granted = await setGrant(page, instance, true)
    await clickSurface(page, instance, kind, '[data-testv3-read-button="gated"]', `${tag}授权后再读`)
    await waitSurface(page, instance, kind, { prefix: ['[data-testv3-read="gated"]', 'ok:'] }, `${tag}授权后的结果`)
    const allowed = await surfaceOf(page, instance, kind)
    check(
      `${tag}由人给出授权之后读得到`,
      granted.status === 200 && allowed.read.gated === `ok:${JSON.stringify({ count: 7002, from: 'gated' })}`,
      `${granted.status} ${allowed.read.gated}`,
    )

    await clickSurface(page, instance, kind, '[data-testv3-read-button="bad"]', `${tag}读 data 不符的源`)
    await waitSurface(page, instance, kind, { prefix: ['[data-testv3-read="bad"]', 'error:'] }, `${tag}schema 不符的结果`)
    const bad = await surfaceOf(page, instance, kind)
    check(`${tag}数据与 schema 不符时错误可见`, bad.read.bad.includes('数据与组件的 data schema 不符'), bad.read.bad)
  }
}

/** 动作、状态写入与能力调用：两种写法走同一条桥，结果按同一份标记取证（D3、D6、D24）。 */
async function interactionPass(page, check, alpha, beta) {
  const sides = [[alpha, NATIVE], [beta, SANDBOX]]
  for (const [instance, kind] of sides) {
    const tag = kind === NATIVE ? '原生卡' : '沙箱卡'
    const book = await probeOf(page, instance)
    await clickSurface(page, instance, kind, '[data-testv3-run]', `${tag}发出动作`)
    const pushed = await waitProbe(page, instance, { atLeast: { pushes: (book.pushes ?? 0) + 1 } }, `${tag}的动作触发推送`)
    await waitSurface(page, instance, kind, { text: ['[data-testv3-count]', pushCount(pushed)] }, `${tag}收到动作触发的数据`)
    check(`${tag}的动作跑得起来，并把新数据推到卡上`, pushed.pushes >= 1, JSON.stringify(pushed))

    await clickSurface(page, instance, kind, '[data-testv3-tap]', `${tag}写一次状态`)
    await waitSurface(page, instance, kind, { text: ['[data-testv3-state]', '1'] }, `${tag}写入状态后的读数`)
    check(`${tag}的状态写入落到卡片上`, true)

    await clickSurface(page, instance, kind, '[data-testv3-echo]', `${tag}调能力`)
    await waitSurface(page, instance, kind, { text: ['[data-testv3-echo-result]', 'ok:"v3"'] }, `${tag}的能力结果`)
    check(`${tag}调得通声明过的能力`, true)

    await clickSurface(page, instance, kind, '[data-testv3-gone]', `${tag}调没有提供方的能力`)
    await waitSurface(page, instance, kind, { prefix: ['[data-testv3-gone-result]', 'error:'] }, `${tag}不可用能力的结果`)
    const surface = await surfaceOf(page, instance, kind)
    check(
      `${tag}调没有提供方的能力时原因可见`,
      surface.gone.includes('没有能力 testv3.gone'),
      surface.gone,
    )
  }
}

/** 一次 v3 提供方的核对；`options.url` 是临时宿主的地址，慢场景要再开一个页面。 */
async function providerV3Pass(page, check, options) {
  // 上一轮跑剩的同款卡片会自己刷新，把计数器推高：先清掉它们，这一轮的判据才从同一个起点开始。
  await removeCardsOf(page, [ALPHA, BETA, LEGACY])
  await openBoard(page)

  // 一个把手挂的两个目录都进了组件库，旧入口的扁平 id 与它并排可用。
  await openLibrary(page)
  const listed = await page.evaluate((ids) => ids.map((id) => document.querySelector(`[data-dsh-widget-board-add="${id}"]`) !== null), [ALPHA, BETA, LEGACY])
  check('新把手两个组件目录的组件与旧入口的组件一起列在组件库里', listed.every(Boolean), listed.join(' / '))

  const alpha = await addWidget(page, ALPHA)
  const beta = await addWidget(page, BETA)
  const legacy = await addWidget(page, LEGACY)
  check('新把手的两个组件各加得到一张卡', alpha !== '' && beta !== '', `${alpha} / ${beta}`)
  check('旧入口的组件在同一台宿主上照常加得进来', legacy !== '', legacy)
  if (alpha === '' || beta === '' || legacy === '') return

  // 第一个目录的组件画在父页面里；第二个目录的组件走沙箱，画在自己的文档里。
  try {
    await page.waitForSelector(`${cardOf(alpha)} [data-native-widget="${V3_PROVIDER}"] [data-testv3="alpha"]`, { timeout: 20000 })
  } catch (error) {
    const html = await page.locator(cardOf(alpha)).evaluate((element) => element.outerHTML).catch(() => '')
    throw new Error(`第一个目录的原生组件没有画出来：${html.slice(0, 600)}\n${error.message}`)
  }
  check('一个把手上的原生组件画在父页面里', true)
  try {
    const frame = await frameOf(page, `${cardOf(beta)} iframe.dsh-widget-board__frame`)
    await frame.waitForSelector('[data-testv3="beta"]', { timeout: 20000 })
  } catch (error) {
    const html = await page.locator(cardOf(beta)).evaluate((element) => element.outerHTML).catch(() => '')
    throw new Error(`第二个目录的沙箱组件没有画出来：${html.slice(0, 600)}\n${error.message}`)
  }
  check('同一个把手第二个目录的组件走沙箱画出来', true)

  // 两张卡摆到同一排并滚进视口：订阅、暂停与推送都从「看得见」开始。
  const slot = await stackCards(page, [alpha, beta])
  await closeLibrary(page)
  await settleRow(page, alpha, beta)
  await revealCards(page, alpha, beta)
  await waitSurface(page, alpha, NATIVE, { attr: ['data-testv3-paused', 'false'] }, '原生卡在视口里')
  await waitSurface(page, beta, SANDBOX, { attr: ['data-testv3-paused', 'false'] }, '沙箱卡在视口里')
  check('两张卡都落在视口里，暂停状态在两种写法上都看得见', true)

  // 可见即订阅：账本按卡片计数，初值经订阅推来。
  const alphaBook = await waitProbe(page, alpha, { equals: { active: 1 }, atLeast: { subscribes: 1 } }, '原生卡可见时订上默认源')
  const betaBook = await waitProbe(page, beta, { equals: { active: 1 }, atLeast: { subscribes: 1 } }, '沙箱卡可见时订上默认源')
  check('两张卡可见时各自订上默认源', alphaBook.active === 1 && betaBook.active === 1, `${JSON.stringify(alphaBook)} / ${JSON.stringify(betaBook)}`)
  await waitSurface(page, alpha, NATIVE, { text: ['[data-testv3-count]', subscribeCount(alphaBook)] }, '原生卡收到订阅初值')
  await waitSurface(page, beta, SANDBOX, { text: ['[data-testv3-count]', subscribeCount(betaBook)] }, '沙箱卡收到订阅初值')
  check('订阅初值经 data 推到两种卡上', true)

  await capabilityFacePass(page, check, alpha, beta)
  await interactionPass(page, check, alpha, beta)
  await dataReadPass(page, check, alpha, beta)

  // 按需读只回数据，卡片不被改写：数据仍是订阅推来的那一条（D32）。
  const afterReads = { alpha: await cardStateOf(page, alpha), beta: await cardStateOf(page, beta) }
  const alphaNow = await probeOf(page, alpha)
  const betaNow = await probeOf(page, beta)
  check(
    '按需读的返回值不自动写卡片',
    afterReads.alpha?.data?.count === Number(pushCount(alphaNow)) && afterReads.beta?.data?.count === Number(pushCount(betaNow)),
    `${JSON.stringify(afterReads.alpha?.data)} / ${JSON.stringify(afterReads.beta?.data)}`,
  )

  // 旧入口固定用版本 2：服务自报 3，数据源把当初注册用的版本一起交上来，判据从这一处读。
  const legacyRead = await readSource(page, legacy, 'test.count')
  check('旧入口的提供方照常读得到数据', legacyRead.status === 200 && typeof legacyRead.body.data?.count === 'number', `${legacyRead.status} ${JSON.stringify(legacyRead.body).slice(0, 90)}`)
  check('旧入口固定注册版本 2，与自报 3 的服务并行', legacyRead.body.data?.apiVersion === 2, `apiVersion=${String(legacyRead.body.data?.apiVersion)}`)

  // 能力路由：参数按声明的 schema 拦下，效果与组件里那一次调用同一条路。
  const echoed = await callCapability(page, alpha, 'testv3.echo', { text: 'v3' })
  check('能力路由调得通', echoed.status === 200 && echoed.body.result?.echo === 'v3', `${echoed.status} ${JSON.stringify(echoed.body).slice(0, 90)}`)
  const badArgs = await callCapability(page, alpha, 'testv3.echo', { text: 7 })
  check('能力的参数按声明的 schema 拦下', badArgs.status === 400, `${badArgs.status} ${JSON.stringify(badArgs.body).slice(0, 90)}`)

  // 慢数据源：8 个槽占满，第 9 个立即被拒；占着的那 8 个按默认时限失败。
  const burst = await openPage(options.url)
  let answer
  try {
    // 这一页先把启动令牌换成会话，之后它的读取才不会被 401 拒掉。
    await burst.page.waitForFunction(async () => (await fetch('api/widget-board/boards')).ok, undefined, { timeout: 60000 })
    const pending = burstReads([page, burst.page], alpha, SLOW)
    // 槽被占着的这十几秒里，另一个提供方照常读得到——并发与超时是按提供方算的（D31）。
    await sleep(1500)
    const otherSide = await readSource(page, legacy, 'test.count')
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

  // 订阅的生命周期：离开视口退订、暂停；回来重订、恢复，重订时实现再推一次初值（D32）。
  await moveCards(page, [alpha, beta], slot + 400)
  await waitSurface(page, alpha, NATIVE, { attr: ['data-testv3-paused', 'true'] }, '原生卡离开视口后暂停')
  await waitSurface(page, beta, SANDBOX, { attr: ['data-testv3-paused', 'true'] }, '沙箱卡离开视口后暂停')
  const alphaOff = await waitProbe(page, alpha, { equals: { active: 0 }, atLeast: { unsubscribes: 1 } }, '原生卡离开视口后退订')
  const betaOff = await waitProbe(page, beta, { equals: { active: 0 }, atLeast: { unsubscribes: 1 } }, '沙箱卡离开视口后退订')
  check(
    '两张卡离开视口后各自退订，暂停状态也一致',
    alphaOff.active === 0 && betaOff.active === 0 && alphaOff.unsubscribes >= 1 && betaOff.unsubscribes >= 1,
    `${JSON.stringify(alphaOff)} / ${JSON.stringify(betaOff)}`,
  )

  await moveCards(page, [alpha, beta], slot)
  await settleRow(page, alpha, beta)
  await revealCards(page, alpha, beta)
  await waitSurface(page, alpha, NATIVE, { attr: ['data-testv3-paused', 'false'] }, '原生卡回到视口后恢复')
  await waitSurface(page, beta, SANDBOX, { attr: ['data-testv3-paused', 'false'] }, '沙箱卡回到视口后恢复')
  const alphaBack = await waitProbe(page, alpha, { equals: { active: 1 }, atLeast: { subscribes: 2 } }, '原生卡回到视口后重订')
  const betaBack = await waitProbe(page, beta, { equals: { active: 1 }, atLeast: { subscribes: 2 } }, '沙箱卡回到视口后重订')
  await waitSurface(page, alpha, NATIVE, { text: ['[data-testv3-count]', subscribeCount(alphaBack)] }, '原生卡收到重订的初值')
  await waitSurface(page, beta, SANDBOX, { text: ['[data-testv3-count]', subscribeCount(betaBack)] }, '沙箱卡收到重订的初值')
  check(
    '两张卡回到视口后各自重订，重订的初值经 data 推来',
    alphaBack.subscribes >= 2 && betaBack.subscribes >= 2,
    `${JSON.stringify(alphaBack)} / ${JSON.stringify(betaBack)}`,
  )

  // 设置页的健康表：注册数、超时数与声明的用途都看得见（D31）。
  await openBoardSettings(page)
  const row = await healthOf(page, V3_PROVIDER)
  check('设置页的健康表列出新把手的提供方', row !== null && row.available === true, JSON.stringify(row))
  check('健康表记下这次注册的各项', row?.registrations === 12, String(row?.registrations))
  check('健康表记下这 8 次超时', (row?.timeouts ?? 0) >= 8, String(row?.timeouts))
  check('健康表写出声明的用途', row?.features.includes('marketProvider') === true && row?.features.includes('capabilityMetadata') === true, (row?.features ?? []).join(','))
  const legacyRow = await healthOf(page, V2_PROVIDER)
  check('旧入口的提供方也在表里，没有声明用途', legacyRow !== null && legacyRow.available === true && legacyRow.features.length === 0, JSON.stringify(legacyRow))
  await closeBoardSettings(page)

  // 停用新把手：组件、数据源、动作与能力一起撤下，卡片留着并显示不可用（D31、D17）。
  await setProviderEnabled(page, V3_PROVIDER, false)
  await openBoard(page)
  await page.waitForSelector(cardOf(alpha), { timeout: 30000 })
  for (const [instance, widget] of [[alpha, ALPHA], [beta, BETA]]) {
    try {
      await page.waitForSelector(`${cardOf(instance)}[data-unavailable="${widget}"]`, { timeout: 30000 })
    } catch (error) {
      const html = await page.locator(cardOf(instance)).evaluate((element) => element.outerHTML).catch(() => '')
      throw new Error(`新把手停用后卡片没有变成不可用：${html.slice(0, 800)}\n${error.message}`)
    }
  }
  check('新把手停用后两张卡都保留并显示不可用', true)
  check('原生组件从卡片上撤下', await page.locator(`${cardOf(alpha)} [data-native-widget="${V3_PROVIDER}"]`).count() === 0)
  check('沙箱组件的文档也从卡片上撤下', await page.locator(`${cardOf(beta)} iframe.dsh-widget-board__frame`).count() === 0)
  const readGone = await readSource(page, alpha, 'testv3.count')
  check('新把手停用后数据源不再解析', readGone.status === 400 && String(readGone.body.error).includes('没有数据源'), `${readGone.status} ${JSON.stringify(readGone.body).slice(0, 90)}`)
  const callGone = await callCapability(page, alpha, 'testv3.echo', { text: 'x' })
  check('新把手停用后能力不再可用', callGone.status === 400 && /没有能力|组件不在组件库里/.test(String(callGone.body.error)), `${callGone.status} ${JSON.stringify(callGone.body).slice(0, 90)}`)

  await openBoardSettings(page)
  const offRow = await healthOf(page, V3_PROVIDER)
  check('停用后健康行写着不可用', offRow !== null && offRow.available === false, JSON.stringify(offRow))
  await closeBoardSettings(page)

  // 启用：注册回来，两种写法的卡片都恢复，订阅也重新开上（D31、D32）。
  await setProviderEnabled(page, V3_PROVIDER, true)
  await openBoard(page)
  await page.waitForSelector(`${cardOf(alpha)} [data-native-widget="${V3_PROVIDER}"]`, { timeout: 30000 })
  await frameOf(page, `${cardOf(beta)} iframe.dsh-widget-board__frame`)
  check('启用后原生组件与沙箱文档都回到卡片', true)
  await settleRow(page, alpha, beta)
  await revealCards(page, alpha, beta)
  const alphaOn = await waitProbe(page, alpha, { equals: { active: 1 }, atLeast: { subscribes: 1 } }, '启用后原生卡重新订上')
  const betaOn = await waitProbe(page, beta, { equals: { active: 1 }, atLeast: { subscribes: 1 } }, '启用后沙箱卡重新订上')
  // 面板重挂时可见集合会翻几次，卡片可能退订又重订；判据只看「订阅确实发生过」与「数据是订阅推来的那一段」。
  await waitSurface(page, alpha, NATIVE, { range: ['[data-testv3-count]', SUBSCRIBE_BASE + 1, SUBSCRIBE_BASE + alphaOn.subscribes] }, '启用后原生卡收到订阅初值')
  await waitSurface(page, beta, SANDBOX, { range: ['[data-testv3-count]', SUBSCRIBE_BASE + 1, SUBSCRIBE_BASE + betaOn.subscribes] }, '启用后沙箱卡收到订阅初值')
  check('启用后两张卡各自重新订阅，初值经 data 推来', alphaOn.subscribes >= 1 && betaOn.subscribes >= 1, `${JSON.stringify(alphaOn)} / ${JSON.stringify(betaOn)}`)
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
  await removeCardsOf(page, [BETA, LEGACY])
}

module.exports = { providerV3Pass }
