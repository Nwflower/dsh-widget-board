#!/usr/bin/env node
/**
 * smoke.cjs — 在真实的临时宿主上走一遍插件自己的表面。
 *
 * 检查的是本插件的判据，不看宿主的实现：侧栏出现入口、点开是一页空看板、样式表挂上、控制台
 * 没有错误。查找只用插件自己写在节点上的标记（`svg.dsh-widget-board__icon` 与
 * `data-dsh-widget-board-*`），所以宿主换了内部结构也不会让这些判据失真（D1）。
 *
 * 用法：node packages/testing/smoke.cjs [--headful]
 */
'use strict'
const { withHost } = require('./dsh-web.cjs')

/** 插件自己画的东西，只用这些标记找节点。 */
const PANEL_ICON = 'svg.dsh-widget-board__icon'
const BOARD_VIEW = '[data-dsh-widget-board-view]'
const BOARD_EMPTY = '[data-dsh-widget-board-empty]'
const SHEET = 'style[data-plugin="dsh-widget-board"]'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 关掉宿主自己在首次启动时打开的浮层。
 *
 * 全新的 `$DSH_HOME` 会依次弹出预告与凭据表单，底下压着一层挡住指针的遮罩。每层都用自己的
 * 按钮回答；连续两次都按不到按钮才算关完了，因为关掉一层之后下一层要过一会儿才挂上来。
 *
 * @param page - 临时宿主上的页面。
 */
async function dismissOverlays(page) {
  let quiet = 0
  for (let pass = 0; pass < 10 && quiet < 2; pass += 1) {
    const pressed = await page.evaluate(() => {
      const shown = (element) => element.checkVisibility() && element.getBoundingClientRect().width > 0
      const layer = Array.from(document.querySelectorAll('[role="dialog"], [role="presentation"]')).filter(shown).pop()
      if (layer === undefined) return false
      const button = Array.from(layer.querySelectorAll('button')).filter(shown)[0]
      if (button === undefined) return false
      button.click()
      return true
    })
    quiet = pressed ? 0 : quiet + 1
    await sleep(1200)
  }
}

/**
 * 走一遍判据。
 *
 * @param page - 临时宿主上的页面。
 * @param problems - 打开页面以来控制台里的错误、警告与未捕获异常。
 * @returns 失败的条数。
 */
async function smoke(page, problems) {
  let failures = 0
  const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  (${detail})`}`)
    if (!ok) failures += 1
  }

  await page.waitForSelector(PANEL_ICON, { timeout: 120000 })
  check('侧栏出现看板入口', true)
  check('插件的样式表挂上了文档', await page.evaluate((selector) => document.querySelector(selector) !== null, SHEET))

  await dismissOverlays(page)
  const opened = await page.evaluate((selector) => {
    const row = document.querySelector(selector)?.closest('button')
    if (row === null || row === undefined) return false
    row.click()
    return true
  }, PANEL_ICON)
  check('侧栏入口点得动', opened)

  const mounted = await page.waitForSelector(BOARD_VIEW, { timeout: 20000 }).then(() => true, () => false)
  check('中栏打开一页看板', mounted)
  if (mounted) {
    check('看板是空的', await page.evaluate((selector) => document.querySelector(selector) !== null, BOARD_EMPTY))
    check('看板占满中栏', await page.evaluate((selector) => {
      const board = document.querySelector(selector)
      const rect = board?.getBoundingClientRect()
      return rect !== undefined && rect.width > 200 && rect.height > 200
    }, BOARD_VIEW))
  }

  const errors = problems.filter((problem) => problem.startsWith('error:') || problem.startsWith('pageerror:'))
  check('控制台没有错误', errors.length === 0, errors.join(' / '))
  const warnings = problems.filter((problem) => problem.startsWith('warning:'))
  if (warnings.length > 0) console.log(`      控制台里有 ${warnings.length} 条警告：${warnings.join(' / ')}`)
  return failures
}

withHost(async ({ page, problems }) => smoke(page, problems)).then((failures) => {
  console.log(failures === 0 ? '\nsmoke: 全部通过' : `\nsmoke: ${failures} 条没有通过`)
  process.exitCode = failures === 0 ? 0 : 1
}, (error) => {
  console.error(error)
  process.exitCode = 1
})
