#!/usr/bin/env node
'use strict'
/**
 * library.cjs — 从下方菜单打开组件库浮窗。
 *
 * 添加按钮在下方菜单里；三个测试场景都要用同一段查找与等待。
 */

/**
 * 打开组件库浮窗；已经打开时直接返回。
 *
 * @param page - 宿主页面，看板已经打开。
 */
async function openLibrary(page) {
  if (await page.locator('[data-dsh-widget-board-library]').count() > 0) return
  const toggle = page.locator('[data-dsh-widget-board-dock-toggle]')
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await page.waitForFunction(() => document.querySelector('[data-dsh-widget-board-dock-toggle]')?.getAttribute('aria-expanded') === 'true', undefined, { timeout: 5000 })
  // 等扇面展开完再点：动作从加号中心飞出去，动画中途点击会落回关闭按钮。
  await new Promise((resolve) => setTimeout(resolve, 500))
  await page.locator('[data-dsh-widget-board-dock-action="add"]').click()
  await page.waitForSelector('[data-dsh-widget-board-library]', { timeout: 10000 })
}

module.exports = { openLibrary }
