#!/usr/bin/env node
'use strict'
/**
 * github.cjs — 「今日宜休」卡在真实宿主里的检查（D24）。
 *
 * 这张卡只在画廊里铺一张，看板上的位置由人自己给：这里先把它加到当前看板，再读它。
 *
 * 临时宿主没有 GitHub 令牌，所以判据是这条正当的空态：卡片停在 `ready`、写着去哪里填令牌、能按下
 * 重新读一次，不转圈也不空着。只认插件自己写在节点上的标记与组件文档里的 `data-state`。
 */
const { frameOf } = require('./frames.cjs')
const { addInstance } = require('./board.cjs')

const TITLE = '今日宜休'

/**
 * 跳转在真实宿主里的检查（D26）。
 *
 * 沙箱组件自己导航不了，点击只能经桥交给父页面；这里直接换掉页面里的 `window.open` 记下收到
 * 的地址，看组件里那一下是否真的到了父页面，并且只收 http 与 https。
 *
 * @param page - 宿主页面。
 * @param frame - 卡片文档。
 * @param check - 记一条判据的函数。
 */
async function openPass(page, frame, check) {
  await page.evaluate(() => {
    const opened = []
    window.__opened = opened
    window.open = (url) => { opened.push(url); return null }
  })
  // 组件里自己造一行带地址的按钮，不依赖有没有令牌与网络：这里只查跳转这条桥。
  // 行要放进列表：点击处理绑在列表上。
  await frame.evaluate(() => {
    const list = document.querySelector('.gh__list')
    list.hidden = false
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'gh__row'
    row.dataset.url = 'https://github.com/Nwflower/dsh-widget-board/issues/1'
    row.textContent = '跳转'
    list.appendChild(row)
    row.click()
  })
  await new Promise((resolve) => setTimeout(resolve, 400))
  const asked = await page.evaluate(() => window.__opened ?? [])
  check('点一行就请父页面开那条 issue', asked.includes('https://github.com/Nwflower/dsh-widget-board/issues/1'), JSON.stringify(asked))

  // 脚本地址不往父页面走：桥上的形状判定先把它拦下，父页面一次都没有收到。
  await frame.evaluate(() => {
    document.querySelector('.gh__row[data-url]').dataset.url = 'javascript:alert(1)'
    document.querySelector('.gh__row[data-url]').click()
  })
  await new Promise((resolve) => setTimeout(resolve, 400))
  const after = await page.evaluate(() => window.__opened ?? [])
  check('脚本地址不会交给父页面打开', after.length === asked.length, JSON.stringify(after))
}

/**
 * 加一张「今日宜休」卡，读它没有令牌时的样子。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param check - 记一条判据的函数。
 */
async function githubPass(page, check) {
  const id = await addInstance(page, 'github-issues')
  check('「今日宜休」卡加得进看板', id !== '')
  if (id === '') return
  const frame = await frameOf(page, `[data-instance="${id}"] iframe.dsh-widget-board__frame[title="${TITLE}"]`)
  await frame.waitForFunction(
    () => document.querySelector('.gh')?.getAttribute('data-state') === 'ready',
    undefined,
    { timeout: 20000 },
  ).catch(() => {})
  const seen = await frame.evaluate(() => {
    const card = document.querySelector('.gh')
    return {
      state: card?.getAttribute('data-state') ?? '',
      tone: card?.getAttribute('data-tone') ?? '',
      text: (document.body.innerText ?? '').replace(/\s+/g, ' ').trim(),
      hasRefresh: card?.querySelector('.gh__refresh') !== null,
    }
  })
  check('没有令牌时卡片停在 ready，不是转圈也不是故障色', seen.state === 'ready' && seen.tone === 'neutral', JSON.stringify({ state: seen.state, tone: seen.tone }))
  check('没有令牌时写着去哪里填', /设置/.test(seen.text) && /令牌/.test(seen.text), seen.text.slice(0, 80))
  check('卡片上有重新读一次的按钮', seen.hasRefresh !== false)

  await openPass(page, frame, check)

  // 后面的场景从原来的看板开始：查完把这张卡收掉。
  await page.locator(`[data-instance="${id}"] [data-dsh-widget-board-handle="remove"]`).click()
  const gone = await page.waitForFunction(
    (cardId) => document.querySelector(`[data-instance="${cardId}"]`) === null,
    id,
    { timeout: 10000 },
  ).then(() => true, () => false)
  check('「今日宜休」卡移掉了', gone)
}

module.exports = { githubPass }
