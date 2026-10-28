#!/usr/bin/env node
'use strict'
/**
 * composer.cjs — 创建卡片与编辑内容的真实宿主检查（C01—C07）。
 *
 * 三条路径都从界面走：下方菜单的「创建卡片」进创建器，填完提交；组件库头部的「创建卡片」也进同一个
 * 弹窗；卡片设置里的「编辑内容」改已有卡片的 data。查找只用插件自己写在节点上的标记
 * （`data-dsh-widget-board-*`），宿主换了内部结构也不会让判据失真（D1）。
 */
const { openDockAction, openLibrary } = require('./library.cjs')
const { waitFor } = require('./road.cjs')

/**
 * 读一次工作区快照。
 *
 * @param page - 宿主页面。
 * @returns 工作区快照。
 */
async function workspace(page) {
  return await page.evaluate(async () => (await fetch('api/widget-board/boards')).json())
}

/**
 * 按卡片 id 从快照里取一张卡。
 *
 * @param page - 宿主页面。
 * @param id - 卡片实例 id。
 * @returns 卡片；没有时是 undefined。
 */
async function cardOf(page, id) {
  const snapshot = await workspace(page)
  return snapshot.boards.flatMap((board) => board.instances).find((candidate) => candidate.id === id)
}

/**
 * 当前看板上某个组件的卡片。
 *
 * @param page - 宿主页面。
 * @param widget - 组件 id。
 * @returns 卡片列表。
 */
async function cardsOf(page, widget) {
  const snapshot = await workspace(page)
  const board = snapshot.boards.find((candidate) => candidate.id === snapshot.active) ?? snapshot.boards[0]
  return board.instances.filter((instance) => instance.widget === widget)
}

/**
 * 打开下方菜单里的「创建卡片」。
 *
 * @param page - 宿主页面，看板已经打开。
 */
async function openComposerFromMenu(page) {
  if (await page.locator('[data-dsh-widget-board-composer]').count() > 0) return
  await openDockAction(page, 'create')
  await page.waitForSelector('[data-dsh-widget-board-composer]', { timeout: 10000 })
}

/**
 * 在创建器里选一个模板。
 *
 * @param page - 宿主页面。
 * @param key - 模板的键。
 */
async function pickTemplate(page, key) {
  await page.locator(`[data-dsh-widget-board-template="${key}"]`).click()
  await page.waitForSelector(`[data-dsh-widget-board-composer-section]`, { timeout: 10000 })
}

/**
 * 往一个字段里填值。
 *
 * @param page - 宿主页面。
 * @param path - 表单里的点分路径，例如 `markdown` 或 `items.0.title`。
 * @param value - 要填的值。
 */
async function fillField(page, path, value) {
  const field = page.locator(`[data-dsh-widget-board-field="${path}"]`).first()
  await field.fill(value)
}

/**
 * 把这一趟建出来的卡片收掉：后面的几何与拖动判据按原来那块看板算，多出来的卡会改变高度与滚动位置。
 *
 * @param page - 宿主页面。
 * @param ids - 这一趟建出来的卡片 id。
 */
async function removeCards(page, ids) {
  await page.evaluate(async (wanted) => {
    for (const id of wanted) {
      await fetch(`api/widget-board/instance/${encodeURIComponent(id)}/remove`, { method: 'POST' })
    }
  }, ids)
  await waitFor(async () => {
    const snapshot = await workspace(page)
    const live = new Set(snapshot.boards.flatMap((board) => board.instances.map((instance) => instance.id)))
    return ids.every((id) => !live.has(id))
  }, 10000)
}

/**
 * 创建器与内容编辑共用的一段：C01 的两个入口、C02 的四个模板、C03 的数组增删排序。
 *
 * @param page - 宿主页面。
 * @param check - 记一条判据。
 */
async function composerPass(page, check) {
  const created = []
  // C01：下方菜单的入口真的打开弹窗。
  await openComposerFromMenu(page)
  check('菜单里的创建卡片打开创建器', await page.locator('[data-dsh-widget-board-composer]').count() === 1)
  const templates = await page.locator('[data-dsh-widget-board-template]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-dsh-widget-board-template')))
  check('创建器列出可用模板', templates.join(',') === 'text,todo,links,countdown,image,advanced', templates.join(','))

  // C02：文本笔记 —— 标题与正文，提交之后卡片带着这两项内容出现。
  const before = (await cardsOf(page, 'markdown')).length
  await pickTemplate(page, 'text')
  await fillField(page, 'title', '冒烟笔记')
  await fillField(page, 'markdown', '## 冒烟笔记\n\n创建器写进来的正文。')
  await page.locator('[data-dsh-widget-board-composer-submit]').click()
  const textCreated = await waitFor(async () => (await cardsOf(page, 'markdown')).length === before + 1, 15000)
  check('文本笔记创建成功', textCreated)
  const textCard = textCreated ? (await cardsOf(page, 'markdown')).find((card) => card.props.title === '冒烟笔记') : undefined
  check('文本笔记的内容落盘', textCard !== undefined && textCard.data?.markdown?.includes('创建器写进来的正文'), JSON.stringify(textCard?.data ?? null))
  if (textCard !== undefined) created.push(textCard.id)

  // C02：待办 —— 数组项加两条，顺序按填的来。
  const todoBefore = (await cardsOf(page, 'todo')).length
  await openComposerFromMenu(page)
  await pickTemplate(page, 'todo')
  await page.locator('[data-dsh-widget-board-add-item="items"]').click()
  await fillField(page, 'items.0.text', '第一条')
  await page.locator('[data-dsh-widget-board-add-item="items"]').click()
  await fillField(page, 'items.1.text', '第二条')
  // C03：数组项的上下移动——把第二条移到第一条前面。
  await page.locator('[data-dsh-widget-board-item]').nth(1).locator('[data-dsh-widget-board-move="up"]').click()
  const order = await page.locator('[data-dsh-widget-board-field^="items."][data-dsh-widget-board-field$=".text"]').evaluateAll((nodes) => nodes.map((node) => node.value))
  check('数组项可以加、可以上下移动', order.join(',') === '第二条,第一条', order.join(','))
  await page.locator('[data-dsh-widget-board-composer-submit]').click()
  const todoCreated = await waitFor(async () => (await cardsOf(page, 'todo')).length === todoBefore + 1, 15000)
  const todoCard = todoCreated ? (await cardsOf(page, 'todo')).at(-1) : undefined
  check('待办清单创建成功且顺序正确', todoCreated && todoCard?.state?.items?.map((item) => item.text).join(',') === '第二条,第一条', JSON.stringify(todoCard?.state ?? null))
  if (todoCard !== undefined) created.push(todoCard.id)

  // C02：链接 —— 一项标题加地址。
  const linksBefore = (await cardsOf(page, 'links')).length
  await openComposerFromMenu(page)
  await pickTemplate(page, 'links')
  await page.locator('[data-dsh-widget-board-add-item="items"]').click()
  await fillField(page, 'items.0.title', '文档')
  await fillField(page, 'items.0.url', 'https://example.com/docs')
  await page.locator('[data-dsh-widget-board-composer-submit]').click()
  const linksCreated = await waitFor(async () => (await cardsOf(page, 'links')).length === linksBefore + 1, 15000)
  const linkCard = linksCreated ? (await cardsOf(page, 'links')).at(-1) : undefined
  check('链接创建成功', linksCreated && linkCard?.data?.items?.[0]?.url === 'https://example.com/docs', JSON.stringify(linkCard?.data ?? null))
  if (linkCard !== undefined) created.push(linkCard.id)

  // C02：倒计时 —— 日期与时刻，时区默认留着。
  const countdownBefore = (await cardsOf(page, 'countdown')).length
  await openComposerFromMenu(page)
  await pickTemplate(page, 'countdown')
  await fillField(page, 'name', '答辩')
  await fillField(page, 'date', '2030-06-01')
  await fillField(page, 'time', '09:00')
  await page.locator('[data-dsh-widget-board-composer-submit]').click()
  const countdownCreated = await waitFor(async () => (await cardsOf(page, 'countdown')).length === countdownBefore + 1, 15000)
  const countdownCard = countdownCreated ? (await cardsOf(page, 'countdown')).at(-1) : undefined
  check('日期倒计时创建成功', countdownCreated && countdownCard?.props?.date === '2030-06-01', JSON.stringify(countdownCard?.props ?? null))
  if (countdownCard !== undefined) created.push(countdownCard.id)

  // C04：宿主拒绝时逐字段原因落回对应的那一行，输入保留。
  await openComposerFromMenu(page)
  await pickTemplate(page, 'links')
  await page.locator('[data-dsh-widget-board-add-item="items"]').click()
  await fillField(page, 'items.0.title', '只有标题')
  await page.locator('[data-dsh-widget-board-composer-submit]').click()
  const issueShown = await waitFor(async () => await page.locator('[data-dsh-widget-board-composer] [data-dsh-widget-board-field-row] .dsh-widget-board__field-error').count() > 0, 10000)
  check('缺地址时把原因放回那一行', issueShown)
  check('被拒绝之后输入还在', await page.locator('[data-dsh-widget-board-field="items.0.title"]').inputValue() === '只有标题')
  const stillOpen = await page.locator('[data-dsh-widget-board-composer]').count() === 1
  check('创建失败不留空卡片', stillOpen && (await cardsOf(page, 'links')).length === linksBefore + 1)
  // 关掉一个有内容的创建器：先确认，再放弃。
  await page.locator('[data-dsh-widget-board-composer-close]').click()
  await page.waitForSelector('[data-dsh-widget-board-composer-discard]', { timeout: 5000 })
  await page.locator('[data-dsh-widget-board-composer-discard]').click()
  await waitFor(async () => await page.locator('[data-dsh-widget-board-composer]').count() === 0, 5000)
  await removeCards(page, created)
}

/**
 * 组件库头部的第二个创建入口（C01）。
 *
 * @param page - 宿主页面。
 * @param check - 记一条判据。
 */
async function libraryEntryPass(page, check) {
  await openLibrary(page)
  await page.locator('[data-dsh-widget-board-library-create]').click()
  const opened = await waitFor(async () => await page.locator('[data-dsh-widget-board-composer]').count() === 1, 10000)
  check('组件库头部也能打开创建器', opened)
  await page.waitForSelector('[data-dsh-widget-board-library]', { state: 'detached', timeout: 5000 })
  check('打开创建器时组件库收起来了', await page.locator('[data-dsh-widget-board-library]').count() === 0)
  await page.locator('[data-dsh-widget-board-composer-close]').click()
  await waitFor(async () => await page.locator('[data-dsh-widget-board-composer]').count() === 0, 5000)
}

/**
 * 编辑一张已有卡片的内容（C02、C05、C06、C07）。
 *
 * @param page - 宿主页面。
 * @param check - 记一条判据。
 */
async function contentPass(page, check) {
  // 这里要一张已经建好的卡：自己建一张，跑完再收掉，不借上一段的产物。
  const createdIds = []
  await openComposerFromMenu(page)
  await pickTemplate(page, 'text')
  await fillField(page, 'title', '冒烟笔记')
  await fillField(page, 'markdown', '第一版正文。')
  await page.locator('[data-dsh-widget-board-composer-submit]').click()
  const built = await waitFor(async () => (await cardsOf(page, 'markdown')).some((card) => card.props.title === '冒烟笔记'), 15000)
  const created = built ? (await cardsOf(page, 'markdown')).find((card) => card.props.title === '冒烟笔记') : undefined
  if (created === undefined) {
    check('编辑内容需要一张建好的卡片', false)
    return
  }
  createdIds.push(created.id)
  const selector = `[data-instance="${created.id}"] [data-dsh-widget-board-handle="settings"]`
  await page.locator(selector).click()
  await page.waitForSelector('[data-dsh-widget-board-editor]', { timeout: 10000 })
  const entry = page.locator('[data-dsh-widget-board-editor-content]')
  await entry.waitFor({ state: 'visible', timeout: 10000 })
  check('卡片设置里有编辑内容入口', await entry.count() === 1)
  await entry.click()
  await page.waitForSelector('[data-dsh-widget-board-content-editor]', { timeout: 10000 })

  // C02：改正文，保存之后宿主上的这一张卡跟着换，别的卡不动。
  const others = (await workspace(page)).boards.flatMap((board) => board.instances).filter((card) => card.id !== created.id)
  await fillField(page, 'markdown', '改成第二版正文。')
  await page.locator('[data-dsh-widget-board-content-save]').click()
  const saved = await waitFor(async () => (await cardOf(page, created.id))?.data?.markdown === '改成第二版正文。', 10000)
  check('内容编辑保存成功', saved)

  // C05：只改这一张卡。
  const after = (await workspace(page)).boards.flatMap((board) => board.instances).filter((card) => card.id !== created.id)
  const untouched = JSON.stringify(others.map((card) => [card.id, card.props, card.data, card.state]))
    === JSON.stringify(after.map((card) => [card.id, card.props, card.data, card.state]))
  check('编辑一张卡不改其它卡片', untouched)

  // C06：保存失败时输入保留。把卡片所在看板的修订号改掉，制造一次冲突。
  await fillField(page, 'markdown', '第三版，会撞上冲突。')
  // 别处改一次这块看板：宿主的修订号随之变化，编辑器手里那份就旧了。
  const board = (await workspace(page)).boards.find((candidate) => candidate.instances.some((card) => card.id === created.id))
  await page.evaluate(async (boardId) => {
    await fetch(`api/widget-board/boards/${encodeURIComponent(boardId)}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '看板' }),
    })
  }, board.id)
  await page.locator('[data-dsh-widget-board-content-save]').click()
  const conflicted = await waitFor(async () => await page.locator('[data-dsh-widget-board-content-stale]').count() === 1, 10000)
  check('修订号过期时给出冲突与两条出路', conflicted)
  check('冲突之后输入还在', await page.locator('[data-dsh-widget-board-field="markdown"]').inputValue() === '第三版，会撞上冲突。')

  // C07 的另一半：另存为新卡片，草稿变成一张新卡。
  const before = (await cardsOf(page, 'markdown')).length
  await page.locator('[data-dsh-widget-board-content-save-as-new]').click()
  const branched = await waitFor(async () => (await cardsOf(page, 'markdown')).length === before + 1, 15000)
  check('冲突之后可以另存为新卡片', branched)
  const all = await cardsOf(page, 'markdown')
  for (const card of all) createdIds.push(card.id)
  await removeCards(page, createdIds)
}

module.exports = { composerPass, contentPass, libraryEntryPass, openComposerFromMenu, pickTemplate }
