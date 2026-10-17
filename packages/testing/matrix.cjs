#!/usr/bin/env node
/**
 * matrix.cjs — 组件尺寸矩阵：在真实临时宿主里把每个组件放进代表性的盒子，检查排版。
 *
 * 只判定用户能观察到的结果：卡片没有横向滚出去、组件画出了内容、可见的交互控件没有被裁掉、
 * 控制台没有错误。失败时把那一格的截图写到 `.debug/matrix/`，供人工核对。
 *
 * 盒子取高度档位的两端与中段、宽度的一列、两列与四列；看板当前列数不足时按当前列数截断。
 *
 * 用法：node packages/testing/matrix.cjs
 */
'use strict'
const { mkdirSync, mkdtempSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { openPage, start } = require('./dsh-web.cjs')
const { frameOf } = require('./frames.cjs')
const { writeLayouts } = require('./board.cjs')
const { openBoard } = require('./panel.cjs')
const { openLibrary } = require('./library.cjs')

const ROOT = join(__dirname, '..', '..')
const SHOTS = join(ROOT, '.debug', 'matrix')
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
 * 量一个盒子里的排版：横向溢出、内容与可见控件。
 *
 * @param frame - 组件 iframe。
 * @returns 判定要用的状态。
 */
async function measure(frame) {
  return frame.evaluate(() => {
    const root = document.documentElement
    const body = document.body
    const controls = Array.from(document.querySelectorAll('button, input, select, textarea, a[href], [role="button"]'))
      .filter((element) => {
        const style = getComputedStyle(element)
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
      })
    /** 控件在可滚动区域里时，滚出去不算裁掉。 */
    const scrollable = (element) => {
      for (let node = element.parentElement; node !== null; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll') return true
      }
      return false
    }
    const clipped = controls
      .filter((element) => !scrollable(element))
      .filter((element) => {
        const box = element.getBoundingClientRect()
        return box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1
      })
      .slice(0, 3)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`.slice(0, 48))
    const media = document.querySelectorAll('canvas, img, svg').length
    return {
      w: innerWidth,
      h: innerHeight,
      scrollX: root.scrollWidth > root.clientWidth + 1 || body.scrollWidth > root.clientWidth + 1,
      content: `${body.innerText ?? ''}${''}`.trim().length + media,
      controls: controls.length,
      clipped,
    }
  })
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
    const instances = snapshot.board.instances
    const frames = new Map()
    for (const instance of instances) {
      const widget = snapshot.widgets[instance.widget]
      if (widget === undefined || widget.hash === undefined) continue
      const title = widget.title.zh || widget.title.en
      frames.set(instance.id, await frameOf(page, `iframe.dsh-widget-board__frame[title="${title}"]`))
    }
    mkdirSync(SHOTS, { recursive: true })
    for (const box of BOXES) {
      const width = Math.min(box.w, metrics.columns) * metrics.columnWidth + (Math.min(box.w, metrics.columns) - 1) * metrics.gap
      const height = box.h * metrics.rootFontSize
      for (const instance of instances) {
        const widget = snapshot.widgets[instance.widget]
        const frame = frames.get(instance.id)
        if (widget === undefined || frame === undefined) {
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
        const seen = await waitBox(frame, width, height)
        const state = await measure(frame)
        const sized = Math.abs(seen.w - width) <= 2 && Math.abs(seen.h - height) <= 2
        const ok = sized && !state.scrollX && state.content > 0 && state.clipped.length === 0
        check(label, ok, JSON.stringify(state))
        if (!ok) {
          await page.locator(`iframe.dsh-widget-board__frame[title="${widget.title.zh || widget.title.en}"]`)
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
        marker.size === 'preview' && marker.placement === 'preview' && !state.scrollX && state.content > 0,
        JSON.stringify({ ...state, ...marker }),
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
