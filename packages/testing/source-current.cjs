'use strict'
/** 当前卡片的源码另存保持实例内容、布局与其它卡片。 */
const { waitFor } = require('./road.cjs')

async function currentSourcePass(page, check) {
  const previous = await page.evaluate(async () => (await (await fetch('api/widget-board/boards')).json()).active)
  const boardId = await page.evaluate(async () => (await (await fetch('api/widget-board/boards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '源码应用验收' }) })).json()).id)
  const original = await page.evaluate(async () => {
    const snapshot = await (await fetch('api/widget-board/boards')).json()
    const response = await fetch(`api/widget-board/boards/${snapshot.active}/compose`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ widget: 'markdown', props: { title: '源码另存检查' }, data: { markdown: '保留这份正文' }, state: null }) })
    const result = await response.json()
    return result.snapshot.boards.flatMap((board) => board.instances).find((instance) => instance.id === result.id)
  })
  const settings = page.locator(`[data-instance="${original.id}"] [data-dsh-widget-board-handle="settings"]`)
  await settings.click()
  await page.locator('[data-dsh-widget-board-editor-content]').click()
  await page.locator('[data-dsh-widget-board-content-source]').click()
  await page.locator('[data-dsh-widget-board-source-editor] .cm-content').waitFor({ timeout: 20000 })
  const editor = page.locator('[data-dsh-widget-board-source-editor] .cm-content')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n<p>当前卡片的源码变体</p>')
  await page.locator('[data-dsh-widget-board-source-save]').click()
  const read = async () => await page.evaluate(async (id) => {
    const snapshot = await (await fetch('api/widget-board/boards')).json()
    return snapshot.boards.flatMap((board) => board.instances).find((instance) => instance.id === id)
  }, original.id)
  check('从现有卡片另存并应用源码', await waitFor(async () => (await read()).widget !== 'markdown', 15000))
  const after = await read()
  check('源码应用保持实例标识、内容与布局', ['id', 'props', 'data', 'state', 'layout'].every((key) => JSON.stringify(original[key]) === JSON.stringify(after[key])))
  check('源码应用创建独立 user 类型', after.widget.startsWith('user-markdown-'))
  await page.locator('[data-dsh-widget-board-content-close]').click()
  const discard = page.locator('[data-dsh-widget-board-content-discard]')
  if (await discard.count() > 0) await discard.click()
  const settingsClose = page.locator('[data-dsh-widget-board-editor-close]')
  if (await settingsClose.count() > 0) await settingsClose.click()
  await page.evaluate(async ([created, previous]) => {
    await fetch(`api/widget-board/boards/${created}/remove`, { method: 'POST' })
    await fetch(`api/widget-board/boards/${previous}/activate`, { method: 'POST' })
  }, [boardId, previous])
}

module.exports = { currentSourcePass }
