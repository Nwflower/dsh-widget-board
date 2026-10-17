#!/usr/bin/env node
'use strict'
/**
 * frames.cjs — 看板卡片与它里面的 iframe：查找、等握手、量盒子、滚进视口。
 *
 * 只认插件自己写在节点上的标记（`iframe.dsh-widget-board__frame` 的标题、`data-instance`），宿主换了
 * 内部结构也不会让这些判据失真（D1）。点击与悬停之前要不要把卡片滚进视口，由调用方决定。
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 等一张卡片的文档完成握手（令牌进了 iframe 才算接上）。
 *
 * @param page - 宿主页面。
 * @param selector - 那张卡片的 iframe。
 * @returns 卡片的 frame。
 */
async function frameOf(page, selector) {
  // 卡片可能正在重挂：iframe 存在但文档还没起来的瞬间要等一等。单次等待要短，
  // 否则一次卡在空白文档上就会把后面的重试全耗掉。
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const handle = await page.$(selector)
    if (handle !== null) {
      const frame = await handle.contentFrame()
      if (frame !== null) {
        const wired = await frame.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--w-color-bg').trim() !== '', undefined, { timeout: 3000 })
          .then(() => true, () => false)
        if (wired) return frame
      }
    }
    await sleep(250)
  }
  throw new Error(`卡片的 iframe 一直没有接上：${selector}\n页面里的 frame：\n${page.frames().map((frame) => `  ${frame.url().slice(-60)}`).join('\n')}`)
}

/**
 * 把一张卡滚到视口中间。
 *
 * 指针落在 iframe 上方时父页面收不到悬停，Playwright 的点击也只滚组件自己的文档；卡片在折叠下面
 * 时要先把承载它的 iframe 滚进视口，点击与悬停才落得到。
 *
 * @param page - 宿主页面。
 * @param title - 卡片 iframe 的标题。
 */
async function centerCard(page, title) {
  await page.evaluate((name) => {
    document.querySelector(`iframe.dsh-widget-board__frame[title="${name}"]`)?.scrollIntoView({ block: 'center' })
  }, title)
  await sleep(300)
}

/**
 * 量一张卡片的盒子与它里面 iframe 的盒子：组件填满卡片，卡片大小由布局给出（D16）。
 *
 * @param page - 宿主页面。
 * @param title - 卡片 iframe 的标题。
 * @returns 两个盒子的像素尺寸。
 */
async function cardBox(page, title) {
  await page.waitForSelector(`iframe.dsh-widget-board__frame[title="${title}"]`, { timeout: 20000 })
  await page.waitForFunction((title) => {
    const frame = document.querySelector(`iframe.dsh-widget-board__frame[title="${title}"]`)
    const card = frame?.closest('[data-instance]')
    return card !== null && card !== undefined && card.getBoundingClientRect().height > 60
  }, title, { timeout: 20000 })
  return page.evaluate((title) => {
    const frame = document.querySelector(`iframe.dsh-widget-board__frame[title="${title}"]`)
    const card = frame?.closest('[data-instance]')
    const outer = card.getBoundingClientRect()
    const inner = frame.getBoundingClientRect()
    return {
      width: Math.round(outer.width),
      height: Math.round(outer.height),
      frameWidth: Math.round(inner.width),
      frameHeight: Math.round(inner.height),
    }
  }, title)
}

module.exports = { cardBox, centerCard, frameOf }
