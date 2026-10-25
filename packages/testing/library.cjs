#!/usr/bin/env node
'use strict'
/**
 * library.cjs — 从下方菜单打开组件库面板。
 *
 * 添加按钮在下方菜单里；三个测试场景都要用同一段查找与等待。面板从底部上拉，打开态由
 * `data-open="true"` 标记；正在收起时先等它走完退场并从页面上摘掉。
 */

/**
 * 打开组件库面板；已经打开时直接返回。
 *
 * @param page - 宿主页面，看板已经打开。
 */
async function openLibrary(page) {
  const panel = page.locator('[data-dsh-widget-board-library]')
  if (await panel.count() > 0) {
    if (await page.locator('[data-dsh-widget-board-library][data-open="true"]').count() > 0) return
    await page.waitForSelector('[data-dsh-widget-board-library]', { state: 'detached', timeout: 5000 })
  }
  const toggle = page.locator('[data-dsh-widget-board-dock-toggle]')
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await page.waitForFunction(() => document.querySelector('[data-dsh-widget-board-dock-toggle]')?.getAttribute('aria-expanded') === 'true', undefined, { timeout: 5000 })
  // 等扇面展开完再点：动作从加号中心飞出去，动画中途点击会落回关闭按钮。
  await new Promise((resolve) => setTimeout(resolve, 500))
  await page.locator('[data-dsh-widget-board-dock-action="add"]').click()
  await page.waitForSelector('[data-dsh-widget-board-library][data-open="true"]', { timeout: 10000 })
}

module.exports = { openLibrary }
