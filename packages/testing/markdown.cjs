#!/usr/bin/env node
'use strict'
/**
 * markdown.cjs — Markdown/代码卡的真实宿主检查（D7）。
 *
 * 从组件库加一张卡，确认默认内容、代码高亮与数据推送；推送里带脚本与危险链接，检查它们被挡在
 * 卡片内容之外。查完把卡片移除，后面的场景仍从原来的看板开始。
 */
const { openLibrary } = require('./library.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 加一张 Markdown 卡、检查排版与转义、再移除。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param check - 记一条判据的函数。
 */
async function markdownPass(page, check) {
  const before = await page.evaluate(() => document.querySelectorAll('[data-instance]').length)
  await openLibrary(page)
  await page.waitForSelector('[data-dsh-widget-board-add="markdown"]', { timeout: 10000 })
  check('组件库里有 Markdown 卡', true)
  await page.locator('[data-dsh-widget-board-add="markdown"]').click()
  await page.waitForFunction((count) => document.querySelectorAll('[data-instance]').length === count + 1, before, { timeout: 15000 })
  const id = await page.evaluate(() => Array.from(document.querySelectorAll('[data-instance]')).at(-1)?.getAttribute('data-instance') ?? '')
  await page.waitForSelector(`[data-instance="${id}"] iframe[title="Markdown"]`, { timeout: 30000 })
  const element = await page.$(`[data-instance="${id}"] iframe[title="Markdown"]`)
  if (element === null) throw new Error('Markdown 卡的文档没有挂上')
  const frame = await element.contentFrame()
  await frame.waitForSelector('.md-card__body h2', { timeout: 15000 })

  const initial = await frame.evaluate(() => ({
    marked: typeof window.marked,
    hljs: typeof window.hljs,
    heading: document.querySelector('.md-card__body h2')?.textContent ?? '',
    code: document.querySelectorAll('.md-card__body .md-code pre code').length,
    keyword: document.querySelectorAll('.md-card__body .hljs-keyword').length,
    table: document.querySelectorAll('.md-card__body table tbody tr').length,
  }))
  check('Markdown 库与高亮库都进了文档', initial.marked === 'function' && initial.hljs === 'object', `${initial.marked} / ${initial.hljs}`)
  check('默认内容排成标题、表格与代码块', initial.heading !== '' && initial.table > 0 && initial.code === 1, `${initial.heading} / ${initial.table} 行 / ${initial.code} 块`)
  check('代码块按语言上了色', initial.keyword > 0, `${initial.keyword} 个关键字`)

  const markdown = [
    '## 推送进来的内容',
    '',
    '<script>window.__bad = 1</script>',
    '',
    '[危险](javascript:alert(1))',
    '',
    '```js',
    'const value = 1',
    '```',
  ].join('\n')
  const pushed = await page.evaluate(async ({ id, markdown }) => {
    const response = await fetch(`api/widget-board/instance/${encodeURIComponent(id)}/data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: { markdown } }),
    })
    return response.status
  }, { id, markdown })
  check('数据推送被宿主接受', pushed === 200, String(pushed))
  await sleep(500)
  const sanitized = await frame.evaluate(() => ({
    heading: document.querySelector('.md-card__body h2')?.textContent ?? '',
    bad: typeof window.__bad,
    scripts: document.querySelectorAll('.md-card__body script').length,
    links: Array.from(document.querySelectorAll('.md-card__body a')).map((node) => node.getAttribute('href')),
    code: document.querySelectorAll('.md-card__body .hljs-keyword').length,
  }))
  check('推送的内容换成新的标题', sanitized.heading === '推送进来的内容')
  check('脚本与危险链接没有执行', sanitized.bad === 'undefined' && sanitized.scripts === 0 && sanitized.links.every((href) => href === null || /^https?:/.test(href)), sanitized.links.join(' / '))
  check('推送的代码块也跟着高亮', sanitized.code > 0)

  await page.locator(`[data-instance="${id}"] [data-dsh-widget-board-handle="remove"]`).click()
  await page.waitForFunction((count) => document.querySelectorAll('[data-instance]').length === count, before, { timeout: 10000 })
  check('Markdown 卡移掉了', true)
}

module.exports = { markdownPass }
