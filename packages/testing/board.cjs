#!/usr/bin/env node
'use strict'
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
/**
 * board.cjs — 看板的测试辅助：读工作区快照、整块提交、复位卡片状态与盒子、改一张卡片的高度、只留画廊（D16、D17、D21）。
 *
 * 布局只走宿主那一份快照与 `POST /boards/<id>/layout`，测试不直接改页面上的坐标；默认作用在当前
 * 选中的那块看板上。卡片状态按卡片 id 写，卡片 id 全工作区唯一，所以哪块看板上的卡都写得进去。
 */

/**
 * 读一次工作区快照。
 *
 * @param page - 宿主页面。
 * @returns 工作区快照。
 */
async function workspace(page) {
  return await page.evaluate(async () => (await fetch('api/widget-board/boards')).json())
}

/**
 * 快照里当前选中的那块看板。
 *
 * @param snapshot - 工作区快照。
 * @returns 那块看板。
 */
function activeBoard(snapshot) {
  return snapshot.boards.find((board) => board.id === snapshot.active) ?? snapshot.boards[0]
}

/**
 * 把当前选中的那块看板切回自由布局：自由坐标只属于自由模式，写 free 盒子的测试先走这一步（D32）。
 *
 * @param page - 宿主页面。
 * @returns 切换之后的看板；排列提交被拒绝（修订号过期之类）时是 `undefined`。
 */
async function ensureFree(page) {
  const snapshot = await workspace(page)
  const board = activeBoard(snapshot)
  if (board.arrangement?.mode !== 'aligned') return board
  const status = await page.evaluate(async ({ boardId, layoutRevision }) => {
    const response = await fetch(`api/widget-board/boards/${encodeURIComponent(boardId)}/arrangement`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedLayoutRevision: layoutRevision, arrangement: { mode: 'free' } }),
    })
    return response.status
  }, { boardId: board.id, layoutRevision: board.layoutRevision })
  if (status !== 200) throw new Error(`切回自由布局失败：${status}`)
  return activeBoard(await workspace(page))
}

/**
 * 按当前快照给选中的那块看板写一份整块布局。
 *
 * @param page - 宿主页面。
 * @param build - 从快照里的实例算出新的布局表。
 */
async function writeLayouts(page, build) {
  await ensureFree(page)
  const snapshot = await workspace(page)
  const board = activeBoard(snapshot)
  const layouts = build(board.instances)
  const status = await page.evaluate(async ({ boardId, layoutRevision, layouts }) => {
    const response = await fetch(`api/widget-board/boards/${encodeURIComponent(boardId)}/layout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layoutRevision, layouts }),
    })
    return response.status
  }, { boardId: board.id, layoutRevision: board.layoutRevision, layouts })
  // 修订号过期（409）或盒子不合法（400）都不能继续：后面的几何与点击点全按这份布局算。
  if (status !== 200) throw new Error(`提交布局失败：${status}`)
}

/**
 * 只留「组件画廊」这一块看板。
 *
 * 第一次启动铺两块看板（D17）：精选的「我的看板」与每个内置组件各一张的画廊。检查按组件标题找
 * 卡片、并把每个内置组件都当作在场，所以让它们面对只有画廊的工作区，找得到唯一的一张。
 *
 * @param page - 宿主页面，看板页还没有打开。
 */
async function keepOnlyGallery(page) {
  const snapshot = await workspace(page)
  const gallery = snapshot.boards.find((board) => board.title === '组件画廊')
  if (gallery === undefined) throw new Error(`工作区里没有「组件画廊」：${snapshot.boards.map((board) => board.title).join('、')}`)
  for (const board of snapshot.boards) {
    if (board.id === gallery.id) continue
    const status = await page.evaluate(async (id) => (await fetch(`api/widget-board/boards/${encodeURIComponent(id)}/remove`, { method: 'POST' })).status, board.id)
    if (status !== 200) throw new Error(`移除看板 ${board.title} 失败：${status}`)
  }
}

/**
 * 把卡片盒子清回一排默认大小：上一轮拖动或缩放留下的布局会让几何与点击点漂。
 *
 * @param page - 宿主页面，看板还没打开。
 */
async function resetLayout(page) {
  await writeLayouts(page, (instances) => {
    const layouts = {}
    instances.forEach((instance, index) => {
      // 天气卡固定在最右一列，拖动测试从 x=2 往左走；其余卡片码在第一列，互不干扰。
      layouts[instance.id] = instance.widget === 'weather'
        ? { x: 2, y: 0, w: 1, h: 22 }
        : { x: 0, y: index * 24, w: 1, h: 22 }
    })
    return layouts
  })
}

/**
 * 改一张卡片的高度，其他卡片保持原样：矮盒子里的排版靠它核对。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param id - 卡片实例的 id。
 * @param height - 新的高度，单位是根字号的倍数。
 */
async function setCardHeight(page, id, height) {
  await writeLayouts(page, (instances) => {
    const layouts = {}
    for (const instance of instances) layouts[instance.id] = instance.id === id ? { ...instance.layout, h: height } : instance.layout
    return layouts
  })
}

/**
 * 把卡片的状态清回初始值：上一轮跑剩的计时、选中日期与清单会让这一轮的判定漂。
 *
 * 全部看板一起清：卡片 id 全工作区唯一，写状态不必先知道它在哪一块上（D21）。
 *
 * @param page - 宿主页面，看板还没打开。
 */
async function resetCards(page) {
  const snapshot = await workspace(page)
  const instances = snapshot.boards.flatMap((board) => board.instances.map((instance) => ({ id: instance.id, widget: instance.widget })))
  const patches = { pomodoro: { minutes: 25, endsAt: 0 }, weather: { day: 0 }, todo: { items: [] } }
  for (const instance of instances) {
    const patch = patches[instance.widget]
    if (patch === undefined) continue
    await page.evaluate(async ({ id, patch }) => {
      await fetch(`api/widget-board/instance/${id}/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch }),
      })
    }, { id: instance.id, patch })
  }
}

/**
 * 往选中的那块看板上加一张卡。
 *
 * 地址与客户端同一条：`api/widget-board/boards/<id>/instance`（D17）。矩阵用它把组件库里没在看板上的
 * 组件也铺上，覆盖不跟着默认看板的组成走（D13）。
 *
 * @param page - 宿主页面。
 * @param widget - 组件 id。
 * @returns 新卡片的实例 id；加不进来时是空串。
 */
async function addInstance(page, widget) {
  return page.evaluate(async (id) => {
    const workspaceBody = await (await fetch('api/widget-board/boards')).json()
    const board = workspaceBody.boards.find((entry) => entry.id === workspaceBody.active) ?? workspaceBody.boards[0]
    const response = await fetch(`api/widget-board/boards/${encodeURIComponent(board.id)}/instance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ widget: id }),
    })
    if (!response.ok) return ''
    return (await response.json()).id ?? ''
  }, widget)
}

/** 整齐模式的真实手势：自身格子内移动不换序，窄屏纵向缩放保留期望宽度。 */
async function alignedGesturesPass(page, check) {
  const { settled } = require('./geometry.cjs')
  const viewport = page.viewportSize()
  const original = (await workspace(page)).active
  const call = (route, body) => page.evaluate(async ({ route, body }) => {
    const response = await fetch(`api/widget-board/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (!response.ok) throw new Error(`手势夹具请求失败：${response.status}`)
    return response.json()
  }, { route, body })
  const id = (await call('boards', { title: '排列手势回归' })).id
  try {
    const ids = []
    for (let index = 0; index < 3; index++) ids.push((await call(`boards/${id}/instance`, { widget: 'markdown' })).id)
    let board = activeBoard(await workspace(page))
    await call(`boards/${id}/arrangement`, { expectedLayoutRevision: board.layoutRevision, arrangement: { mode: 'aligned', aligned: { order: ids, boxes: Object.fromEntries(ids.map((key, index) => [key, { w: index === 0 ? 2 : 1, h: 22 }])) } } })
    const card = page.locator(`.dsh-widget-board__flow[data-active="true"] [data-instance="${ids[0]}"]`).first()
    await card.waitFor()
    await card.scrollIntoViewIfNeeded()
    await settled(page)
    board = activeBoard(await workspace(page))
    const move = await card.locator('[data-dsh-widget-board-handle="move"]').boundingBox()
    if (move === null) throw new Error('找不到移动手柄')
    await page.mouse.move(move.x + move.width / 2, move.y + move.height / 2)
    await page.mouse.down()
    await page.mouse.move(move.x + move.width / 2 + 8, move.y + move.height / 2)
    await page.mouse.up()
    await page.waitForFunction(async ({ id, revision }) => (await (await fetch('api/widget-board/boards')).json()).boards.find(board => board.id === id).layoutRevision > revision, { id, revision: board.layoutRevision })
    const moved = activeBoard(await workspace(page))
    check('整齐模式在自身格子内拖动保持顺序', JSON.stringify(moved.arrangement.aligned.order) === JSON.stringify(ids))
    await page.setViewportSize({ width: 640, height: 900 })
    await page.waitForFunction(() => document.querySelector('[data-dsh-widget-board-columns]')?.getAttribute('data-dsh-widget-board-columns') === '1')
    await card.scrollIntoViewIfNeeded()
    await settled(page)
    board = activeBoard(await workspace(page))
    const resize = await card.locator('[data-dsh-widget-board-handle="resize"]').boundingBox()
    if (resize === null) throw new Error('找不到缩放手柄')
    await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2)
    await page.mouse.down()
    await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2 + 64, { steps: 8 })
    await page.mouse.up()
    await page.waitForFunction(async ({ id, revision }) => (await (await fetch('api/widget-board/boards')).json()).boards.find(board => board.id === id).layoutRevision > revision, { id, revision: board.layoutRevision })
    const resized = activeBoard(await workspace(page)).arrangement.aligned.boxes[ids[0]]
    check('窄屏只纵向缩放保留跨列期望', resized.w === 2 && resized.h > board.arrangement.aligned.boxes[ids[0]].h, JSON.stringify(resized))
  } finally {
    await page.mouse.up()
    await call(`boards/${original}/activate`)
    await call(`boards/${id}/remove`)
    await page.setViewportSize(viewport)
  }
}

/** 独立测试目录里的零高度组件，不依赖高度消息确认初始化。 */
function createHandshakeFixture(home) {
  const directory = join(home, 'widget-board/widgets/handshake-zero')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'widget.json'), JSON.stringify({ id: 'handshake-zero', title: { zh: '零高度握手', en: 'Zero-height handshake' }, version: '0.1.0', sizes: ['s'], props: { type: 'object', additionalProperties: false } }))
  writeFileSync(join(directory, 'index.html'), '<div>握手回执回归</div>')
  writeFileSync(join(directory, 'style.css'), 'html,body{height:0!important;min-height:0!important}div{position:fixed;top:0}')
  writeFileSync(join(directory, 'main.js'), 'window.handshakeBoot = String(Date.now())')
}

/** 初始化成功后跨过父页面原有六秒看门时限，文档不能因为没有高度消息而重载。 */
async function handshakePass(page, check) {
  const original = (await workspace(page)).active
  const call = (route, body) => page.evaluate(async ({ route, body }) => {
    const response = await fetch(`api/widget-board/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (!response.ok) throw new Error(`握手夹具请求失败：${response.status}`)
    return response.json()
  }, { route, body })
  const id = (await call('boards', { title: '握手回归' })).id
  try {
    const instance = (await call(`boards/${id}/instance`, { widget: 'handshake-zero' })).id
    const card = page.locator(`[data-instance="${instance}"]`).first()
    await card.waitFor()
    const frame = await (await card.locator('iframe').elementHandle()).contentFrame()
    await frame.waitForFunction(() => window.handshakeBoot && getComputedStyle(document.documentElement).getPropertyValue('--w-color-bg').trim())
    const before = await frame.evaluate(() => ({ boot: window.handshakeBoot, height: document.body.getBoundingClientRect().height }))
    await page.waitForTimeout(7200)
    const after = await frame.evaluate(() => ({ boot: window.handshakeBoot, height: document.body.getBoundingClientRect().height }))
    check('零高度组件确认初始化且不触发超时重载', before.height === 0 && after.height === 0 && before.boot === after.boot)
  } finally {
    await call(`boards/${original}/activate`)
    await call(`boards/${id}/remove`)
  }
}

module.exports = { activeBoard, addInstance, alignedGesturesPass, createHandshakeFixture, handshakePass, ensureFree, keepOnlyGallery, resetCards, resetLayout, setCardHeight, workspace, writeLayouts }
