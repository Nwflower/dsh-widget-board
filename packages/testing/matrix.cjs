#!/usr/bin/env node
/**
 * matrix.cjs — 组件尺寸矩阵：在真实临时宿主里把每个组件放进代表性的盒子，检查排版（D13）。
 *
 * 判定只走组件运行时里的检查器：横向溢出、被盒子截掉的文字与可见控件、空白画面、脚本错误与
 * CSP 违规，与 `widget_define` 的自检是同一份判据。失败时把那一格的截图写到 `.debug/matrix/`，
 * 供人工核对。
 *
 * 盒子取高度档位的两端与中段、宽度的一列、两列与四列；看板当前列数不足时按当前列数截断。
 * 默认看板只铺一部分组件（D17），矩阵把组件库里其余的都加到看板上，覆盖不跟着默认看板的组成走。
 *
 * 用法：node packages/testing/matrix.cjs
 */
'use strict'
const { mkdirSync, mkdtempSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { openPage, start } = require('./dsh-web.cjs')
const { frameOf } = require('./frames.cjs')
const { writeLayouts, addInstance } = require('./board.cjs')
const { openBoard } = require('./panel.cjs')
const { openLibrary } = require('./library.cjs')

const ROOT = join(__dirname, '..', '..')
const SHOTS = join(ROOT, '.debug', 'matrix')
/** 检查器在组件文档里的全局名（`contracts` 的 `INSPECT_GLOBAL`）。 */
const INSPECT_GLOBAL = '__dshWidgetInspect'
const BOXES = [
  { w: 1, h: 6 },
  { w: 1, h: 10 },
  { w: 1, h: 14 },
  { w: 2, h: 14 },
  { w: 1, h: 22 },
  { w: 2, h: 22 },
  { w: 1, h: 30 },
  { w: 4, h: 30 },
]
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let failures = 0
let skipped = 0

/** 记一条判据。 */
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  (${detail})`}`)
  if (!ok) failures += 1
}

/**
 * 量这一帧看板的列宽与根字号。
 *
 * @param page - 宿主页面。
 * @returns 列数、列宽、间距与根字号。
 */
async function boardMetrics(page) {
  return page.evaluate(() => {
    const view = document.querySelector('[data-dsh-widget-board-view]')
    const flow = document.querySelector('.dsh-widget-board__flow')
    const columns = Number(view?.getAttribute('data-dsh-widget-board-columns') ?? 1)
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const gap = rootFontSize * 0.75
    const width = flow?.getBoundingClientRect().width ?? 0
    const columnWidth = (width - gap * (columns - 1)) / columns
    return { columns, columnWidth, gap, rootFontSize }
  })
}

/**
 * 把目标卡片放进给定盒子，其余卡片挪到下方，免得压住它。
 *
 * @param page - 宿主页面。
 * @param target - 目标卡片的实例 id。
 * @param box - 目标盒子。
 * @param metrics - 当前列数与列宽。
 */
async function placeTarget(page, target, box, metrics) {
  await writeLayouts(page, (instances) => {
    const layouts = {}
    instances.forEach((instance, index) => {
      layouts[instance.id] = instance.id === target
        ? { x: 0, y: 0, w: Math.min(box.w, metrics.columns), h: box.h }
        : { x: index % metrics.columns, y: 60 + index * 6, w: 1, h: 6 }
    })
    return layouts
  })
  await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'start' }), '[data-dsh-widget-board-view]')
}

/**
 * 等卡片的 iframe 视口变成目标像素盒。
 *
 * @param frame - 组件 iframe。
 * @param width - 期望宽度。
 * @param height - 期望高度。
 * @returns 最后一次读到的视口尺寸。
 */
async function waitBox(frame, width, height) {
  let seen = { w: 0, h: 0 }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    seen = await frame.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    if (Math.abs(seen.w - width) <= 2 && Math.abs(seen.h - height) <= 2) return seen
    await sleep(80)
  }
  return seen
}

/**
 * 量一个盒子里的排版：调用组件运行时里的检查器（D13），判定与自检用同一份。
 *
 * @param frame - 组件 iframe。
 * @returns 报告与它读出的问题；运行时没装检查器时是 `null`。
 */
async function measure(frame) {
  return frame.evaluate((name) => {
    const inspect = window[name]
    if (typeof inspect !== 'function') return null
    const report = inspect()
    const problems = []
    if (report.overflowX) problems.push('内容横向超出了盒子')
    if (report.clippedText.length > 0) problems.push(`文字被截掉：${report.clippedText.join('、')}`)
    if (report.clippedControls.length > 0) problems.push(`控件被截掉：${report.clippedControls.join('、')}`)
    if (report.blank) problems.push('画面是空白的')
    for (const error of report.errors) problems.push(`脚本错误：${error}`)
    for (const blocked of report.csp) problems.push(`CSP 拦下了：${blocked}`)
    return { report, problems }
  }, INSPECT_GLOBAL)
}

start({ home: mkdtempSync(join(ROOT, '.debug', 'matrix-')) }).then(async (host) => {
  let opened
  try {
    opened = await openPage(host.url, { width: 1600, height: 1000 })
    const page = opened.page
    await page.waitForSelector('svg.dsh-widget-board__icon', { timeout: 120000 })
    await openBoard(page)
    const snapshot = await page.evaluate(async () => {
      const workspace = await (await fetch('api/widget-board/boards')).json()
      return { ...workspace, board: workspace.boards.find((entry) => entry.id === workspace.active) ?? workspace.boards[0] }
    })
    const metrics = await boardMetrics(page)
    // 矩阵铺满组件库里的每个组件，不跟着默认看板的组成走：默认看板只放一部分卡（D17）。
    const missing = Object.values(snapshot.widgets)
      .filter((widget) => widget.hash !== undefined && !snapshot.board.instances.some((instance) => instance.widget === widget.id))
      .map((widget) => widget.id)
    for (const widget of missing) {
      await addInstance(page, widget)
    }
    await page.waitForFunction(
      (count) => document.querySelectorAll('.dsh-widget-board__flow[data-active="true"] [data-instance]').length >= count,
      snapshot.board.instances.length + missing.length,
      { timeout: 30000 },
    ).catch(() => {})
    await sleep(500)
    const current = await page.evaluate(async () => {
      const workspace = await (await fetch('api/widget-board/boards')).json()
      return workspace.boards.find((entry) => entry.id === workspace.active) ?? workspace.boards[0]
    })
    const instances = current.instances
    // 卡片按实例 id 找：精选看板与画廊里同名组件不止一张，按标题会量到另一张。刚加上的卡要到
    // 它被摆进视口之后才握手，所以先按盒子试一次，连不上就在量它之前重来。
    const frameSelector = (id) => `.dsh-widget-board__flow[data-active="true"] [data-instance="${id}"] iframe.dsh-widget-board__frame`
    const frames = new Map()
    for (const instance of instances) {
      const widget = snapshot.widgets[instance.widget]
      if (widget === undefined || widget.hash === undefined) continue
      const frame = await frameOf(page, frameSelector(instance.id)).catch(() => null)
      if (frame !== null) frames.set(instance.id, frame)
    }
    mkdirSync(SHOTS, { recursive: true })
    for (const box of BOXES) {
      const width = Math.min(box.w, metrics.columns) * metrics.columnWidth + (Math.min(box.w, metrics.columns) - 1) * metrics.gap
      const height = box.h * metrics.rootFontSize
      for (const instance of instances) {
        const widget = snapshot.widgets[instance.widget]
        const cached = frames.get(instance.id)
        if (widget === undefined) {
          check(`盒子 ${box.w}×${box.h}rem 的 ${instance.widget}`, false, '组件或画面不可用')
          continue
        }
        const minBox = snapshot.widgets[instance.widget]?.minBox
        if (minBox !== undefined && (box.w < minBox.w || box.h < minBox.h)) {
          skipped += 1
          console.log(`SKIP  ${widget.title.zh || widget.title.en} ${box.w}×${box.h}rem  (组件下限 ${minBox.w}×${minBox.h}rem)`)
          continue
        }
        const label = `${widget.title.zh || widget.title.en} ${Math.min(box.w, metrics.columns)}×${box.h}rem`
        await placeTarget(page, instance.id, box, metrics)
        await sleep(180)
        // 摆进视口之后再握手：刚加上的卡这时候才加载文档。
        const frame = cached ?? await frameOf(page, frameSelector(instance.id)).catch(() => null)
        if (frame === null) {
          check(label, false, '卡片的 iframe 没有接上')
          continue
        }
        frames.set(instance.id, frame)
        const seen = await waitBox(frame, width, height)
        const state = await measure(frame)
        const sized = Math.abs(seen.w - width) <= 2 && Math.abs(seen.h - height) <= 2
        const ok = sized && state !== null && state.problems.length === 0
        check(label, ok, state === null ? '组件文档里没有检查器' : JSON.stringify({ problems: state.problems, seen, want: { width, height } }))
        if (!ok) {
          await page.locator(frameSelector(instance.id))
            .screenshot({ path: join(SHOTS, `${instance.widget}-${box.w}x${box.h}.png`) })
            .catch(() => {})
        }
      }
    }
    const errors = opened.problems.filter((problem) => problem.startsWith('error:') || problem.startsWith('pageerror:'))
    check('尺寸矩阵下控制台没有错误', errors.length === 0, errors.join(' / '))

    // 缩略画面：每个组件都标成 preview，画面不横向滚出去，也不是空白。
    await openLibrary(page)
    for (const instance of instances) {
      const widget = snapshot.widgets[instance.widget]
      if (widget === undefined) continue
      const title = widget.title.zh || widget.title.en
      const frame = await frameOf(page, `.dsh-widget-board__library-preview iframe.dsh-widget-board__frame[title="${title}"]`)
      const state = await measure(frame)
      const marker = await frame.evaluate(() => ({
        size: document.documentElement.dataset.size,
        placement: document.documentElement.dataset.placement,
      }))
      check(
        `缩略画面 ${title}`,
        marker.size === 'preview' && marker.placement === 'preview' && state !== null && state.problems.length === 0,
        state === null ? '组件文档里没有检查器' : JSON.stringify(state.problems),
      )
    }
  } finally {
    if (opened !== undefined) await opened.close()
    host.stop()
    rmSync(host.home, { recursive: true, force: true })
  }
  console.log(failures === 0 ? `\nmatrix: 全部通过（跳过 ${String(skipped)} 格低于组件下限的盒子）` : `\nmatrix: ${failures} 条没有通过，跳过 ${String(skipped)} 格`)
  process.exitCode = failures === 0 ? 0 : 1
}, (error) => {
  console.error(error)
  process.exitCode = 1
})
