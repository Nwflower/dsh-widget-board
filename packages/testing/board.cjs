#!/usr/bin/env node
'use strict'
/**
 * board.cjs — 看板的测试辅助：读工作区快照、整块提交、复位卡片状态与盒子、改一张卡片的高度（D16、D21）。
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
 * 按当前快照给选中的那块看板写一份整块布局。
 *
 * @param page - 宿主页面。
 * @param build - 从快照里的实例算出新的布局表。
 */
async function writeLayouts(page, build) {
  const snapshot = await workspace(page)
  const board = activeBoard(snapshot)
  const layouts = build(board.instances)
  await page.evaluate(async ({ boardId, layoutRevision, layouts }) => {
    await fetch(`api/widget-board/boards/${encodeURIComponent(boardId)}/layout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layoutRevision, layouts }),
    })
  }, { boardId: board.id, layoutRevision: board.layoutRevision, layouts })
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

module.exports = { activeBoard, resetCards, resetLayout, setCardHeight, workspace, writeLayouts }
