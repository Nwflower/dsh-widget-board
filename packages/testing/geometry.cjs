#!/usr/bin/env node
'use strict'
/**
 * geometry.cjs — 看板的几何与布局：等卡片停稳、读一张卡在宿主上的布局、等它变成预期的样子。
 *
 * 真实宿主上的冒烟与演示页的验收共用这一份；两边的布局都经 `api/widget-board/boards` 这一条路由读。
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 等看板的几何稳定下来：卡片的高度刚上报时位置还在移位，点击会打在正在移动的节点上。
 *
 * @param page - 宿主页面。
 * @param timeout - 最长等多久，毫秒。
 */
async function settled(page, timeout = 10000) {
  await page.evaluate(() => { window.__boardGeometry = undefined })
  await page.waitForFunction(() => {
    const key = Array.from(document.querySelectorAll('[data-instance]')).map((node) => {
      const rect = node.getBoundingClientRect()
      return `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`
    }).join('|')
    const seen = window.__boardGeometry
    window.__boardGeometry = key
    return seen !== undefined && seen === key
  }, undefined, { timeout, polling: 300 })
}

/**
 * 读一张卡片在宿主上的布局。
 *
 * @param page - 宿主页面。
 * @param id - 卡片实例的 id。
 * @returns 卡片布局，找不到时为 undefined。
 */
async function layoutOf(page, id) {
  return page.evaluate(async (id) => {
    const workspace = await (await fetch('api/widget-board/boards')).json()
    const board = workspace.boards.find((entry) => entry.id === workspace.active) ?? workspace.boards[0]
    return board.instances.find((instance) => instance.id === id)?.layout
  }, id)
}

/**
 * 等宿主上的布局满足条件：松手之后写入要经过一次往返。
 *
 * @param page - 宿主页面。
 * @param id - 卡片实例的 id。
 * @param done - 判断条件。
 * @returns 满足条件时的布局。
 */
async function waitLayout(page, id, done) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const layout = await layoutOf(page, id)
    if (layout !== undefined && done(layout)) return layout
    await sleep(200)
  }
  throw new Error(`卡片 ${id} 的布局一直没有变成预期的样子：${JSON.stringify(await layoutOf(page, id))}`)
}

/**
 * 一列加一个间距有多宽：拖动一格要移动的像素。
 *
 * @param page - 宿主页面，看板已经打开。
 * @returns 像素。
 */
async function columnStep(page) {
  return page.evaluate(() => {
    const view = document.querySelector('[data-dsh-widget-board-view]')
    const flow = document.querySelector('.dsh-widget-board__flow')
    const columns = Number(view?.getAttribute('data-dsh-widget-board-columns') ?? 0)
    const gap = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.75
    return (flow.getBoundingClientRect().width - gap * (columns - 1)) / columns + gap
  })
}

module.exports = { columnStep, layoutOf, settled, waitLayout }
