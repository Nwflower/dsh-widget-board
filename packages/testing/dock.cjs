#!/usr/bin/env node
'use strict'
/**
 * dock.cjs — 下方菜单、拖放添加、整理与主动刷新的真实宿主检查。
 *
 * 只认插件自己写在节点上的标记；看板数据从插件的私有路由读，清理也用同一张表的移除路由。查完
 * 把拖进去的卡片删掉，后面的布局场景仍从原来的看板开始。
 */
const DOCK = '[data-dsh-widget-board-dock-toggle]'
const ACTION = '[data-dsh-widget-board-dock-action]'
const LIBRARY = '[data-dsh-widget-board-library]'
const PROXY = '[data-dsh-widget-board-drag-proxy]'
const SHIELD = '[data-dsh-widget-board-drag-shield]'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 读一次工作区快照，取出当前选中的那块看板（D21）。 */
async function snapshot(page) {
  const workspace = await page.evaluate(async () => (await fetch('api/widget-board/boards')).json())
  return { ...workspace, board: workspace.boards.find((board) => board.id === workspace.active) ?? workspace.boards[0] }
}

/**
 * 看板上有几个卡片盒子：组卡的两条实例记录只算一格。
 *
 * @param board - 快照里的看板。
 * @returns 卡片盒子的数量。
 */
function cardCount(board) {
  const groups = new Set()
  let count = 0
  for (const instance of board.instances) {
    if (instance.group === undefined) {
      count += 1
    } else if (!groups.has(instance.group.id)) {
      groups.add(instance.group.id)
      count += 1
    }
  }
  return count
}

/**
 * 下方菜单与组件库：三个动作、拖放添加、密排、主动刷新。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param check - 记一条判据的函数。
 */
async function dockPass(page, check) {
  // 上一段收起菜单后的回弹动画还没走完，等加号停稳再点。
  await sleep(900)
  // 菜单：固定在看板这一栏下方的加号，点开是三个动作。
  await page.locator(DOCK).click()
  await page.waitForSelector(`${ACTION}[data-dsh-widget-board-dock-action="add"]`, { timeout: 5000 })
  // 扇面展开期间动作还在加号中心，等它停住再点。
  await sleep(500)
  const menu = await page.evaluate((selector) => {
    const plus = document.querySelector(selector)
    const actions = Array.from(document.querySelectorAll('[data-dsh-widget-board-dock-action]'))
    const rect = plus?.getBoundingClientRect()
    const board = document.querySelector('.dsh-widget-board')
    const boardCenter = board === null ? null : board.getBoundingClientRect().left + board.clientWidth / 2
    return {
      expanded: plus?.getAttribute('aria-expanded'),
      actions: actions.map((node) => node.getAttribute('data-dsh-widget-board-dock-action')),
      labels: actions.map((node) => node.getAttribute('aria-label') ?? ''),
      centered: rect === undefined || boardCenter === null ? false : Math.abs(rect.left + rect.width / 2 - boardCenter) < 2,
      bottom: rect === undefined ? false : window.innerHeight - rect.bottom < 60,
    }
  }, DOCK)
  check('下方菜单展开三个动作', menu.expanded === 'true' && menu.actions.join(',') === 'add,tidy,refresh', menu.actions.join(' / '))
  check('三个动作都有名字', menu.labels.every((label) => label.length > 0), menu.labels.join(' / '))
  check('菜单固定在看板这一栏的下方居中', menu.centered && menu.bottom)

  // 添加动作打开悬浮的组件库：按来源分组的网格，每格画着组件自己的缩略画面。
  await page.locator(`${ACTION}[data-dsh-widget-board-dock-action="add"]`).click()
  await page.waitForSelector(LIBRARY, { timeout: 5000 })
  await page.waitForSelector(`${LIBRARY} iframe`, { timeout: 10000 })
  const library = await page.evaluate((selector) => {
    const node = document.querySelector(selector)
    const style = node === null ? null : getComputedStyle(node)
    const grid = node?.querySelector('.dsh-widget-board__library-list')
    const rect = node?.getBoundingClientRect()
    const board = document.querySelector('.dsh-widget-board')
    const boardCenter = board === null ? null : board.getBoundingClientRect().left + board.clientWidth / 2
    return {
      position: style?.position ?? '',
      tiles: document.querySelectorAll('[data-dsh-widget-board-add]').length,
      display: grid === null ? '' : getComputedStyle(grid).display,
      columns: grid === null ? '' : getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      previews: document.querySelectorAll(`${selector} iframe`).length,
      centered: rect === undefined || boardCenter === null ? false : Math.abs(rect.left + rect.width / 2 - boardCenter) < 2,
    }
  }, LIBRARY)
  check('添加动作打开悬浮组件库', library.position === 'fixed' && library.tiles >= 3, `${library.position} / ${library.tiles} 格`)
  check('组件库浮窗与菜单同一条中线', library.centered)
  check('组件库排成网格', library.display === 'grid' && library.columns >= 2, `${library.display} / ${library.columns} 列`)
  check('每一格画着组件的画面', library.previews >= 3, `${library.previews} 个预览`)

  // 浮窗整个落在窗口里：题头与关闭钮在上、下缘在加号之上。别的插件常给所有对话窗统一定一个
  // 「整页减一点」的上限，浮窗若带上那个角色就会跟着长到窗口之外，这一条连同那条规则一起查。
  const boxOf = () => page.evaluate((selector) => {
    const node = document.querySelector(selector)
    const head = node?.querySelector('.dsh-widget-board__library-head')
    const dock = document.querySelector('[data-dsh-widget-board-dock-toggle]')
    if (node === null || head === null || dock === null) return null
    const rect = node.getBoundingClientRect()
    const headRect = head.getBoundingClientRect()
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      height: Math.round(rect.height),
      headTop: Math.round(headRect.top),
      headHeight: Math.round(headRect.height),
      dockTop: Math.round(dock.getBoundingClientRect().top),
    }
  }, LIBRARY)
  const placement = await boxOf()
  check(
    '组件库浮窗整个落在窗口里',
    placement !== null && placement.top >= 0 && placement.headTop >= 0 && placement.headHeight > 0 && placement.bottom <= placement.dockTop,
    JSON.stringify(placement),
  )
  await page.addStyleTag({
    content: 'body[data-dsh-widget-board-foreign] :is(dialog, [role="dialog"]) { max-width: calc(100vw - 48px); max-height: calc(100vh - 48px); }',
  })
  await page.evaluate(() => { document.body.setAttribute('data-dsh-widget-board-foreign', '') })
  const stressed = await boxOf()
  await page.evaluate(() => { document.body.removeAttribute('data-dsh-widget-board-foreign') })
  check('别的插件给对话窗统一定尺寸时浮窗不动', stressed !== null && stressed.height === placement?.height && stressed.top === placement?.top, JSON.stringify(stressed))

  // 按住一格拖到看板：拖放预览跟着指针，松手后看板多一张卡，且落在右侧一列。
  const before = await snapshot(page)
  const tile = page.locator('[data-dsh-widget-board-add="stat"]').first()
  await tile.scrollIntoViewIfNeeded()
  const box = await tile.boundingBox()
  if (box === null) throw new Error('组件库里的数字组件没有盒子')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 112, { steps: 8 })
  await page.waitForSelector(PROXY, { timeout: 3000 })
  const dragging = await page.evaluate(({ proxy, shield }) => ({
    proxy: document.querySelector(proxy) !== null,
    transform: document.querySelector(proxy)?.style.transform ?? '',
    shield: document.querySelector(shield) !== null,
  }), { proxy: PROXY, shield: SHIELD })
  check('拖动时预览卡跟着指针', dragging.proxy && dragging.transform.includes('translate3d') && dragging.shield, dragging.transform)
  // 组件库按看板中线居中之后，浮窗盖住了这块区域的上半；落到浮窗下方，仍在中栏的同一列。
  await page.mouse.move(1100, 780, { steps: 18 })
  await sleep(120)
  await page.mouse.up()
  await page.waitForFunction((count) => document.querySelectorAll('[data-instance]').length === count + 1, cardCount(before.board), { timeout: 10000 })
  await page.waitForFunction((selector) => document.querySelector(selector) === null, LIBRARY, { timeout: 5000 })
  const after = await snapshot(page)
  const added = after.board.instances.find((instance) => !before.board.instances.some((old) => old.id === instance.id))
  check('拖到看板后多一张卡', after.board.instances.length === before.board.instances.length + 1 && added !== undefined)
  check('新卡片落在松手的列上', added?.layout.x === 2 && added.layout.y > 0, JSON.stringify(added?.layout))

  // 整理：宿主接受整块布局，修订号加一，卡片还在。
  await page.locator(DOCK).click()
  await sleep(500)
  const revision = after.board.layoutRevision
  await page.locator(`${ACTION}[data-dsh-widget-board-dock-action="tidy"]`).click()
  await page.waitForFunction(async (previous) => {
    const workspace = await (await fetch('api/widget-board/boards')).json()
    const board = workspace.boards.find((entry) => entry.id === workspace.active) ?? workspace.boards[0]
    return board.layoutRevision > previous
  }, revision, { timeout: 10000 })
  const tidied = await snapshot(page)
  check('整理提交了整块布局', tidied.board.layoutRevision > revision)
  check('整理之后卡片数量不变', tidied.board.instances.length === after.board.instances.length)

  // 主动刷新：宿主重读组件库，页面上的卡片按新的 generation 重新挂载。
  await sleep(900)
  await page.locator(DOCK).click()
  await sleep(500)
  const frameCount = await page.locator('[data-instance]').count()
  await page.locator(`${ACTION}[data-dsh-widget-board-dock-action="refresh"]`).click()
  await sleep(1800)
  check('主动刷新之后看板还在', await page.locator('[data-instance]').count() === frameCount)
  check('主动刷新之后没有错误横幅', await page.locator('.dsh-widget-board__notice').count() === 0)

  // 清理拖进去的那张卡，后面的布局场景从原来的看板开始。
  if (added !== undefined) {
    await page.evaluate(async (id) => {
      await fetch(`api/widget-board/instance/${encodeURIComponent(id)}/remove`, { method: 'POST' })
    }, added.id)
    await page.waitForFunction((count) => document.querySelectorAll('[data-instance]').length === count, cardCount(tidied.board) - 1, { timeout: 5000 })
  }
}

module.exports = { dockPass }
