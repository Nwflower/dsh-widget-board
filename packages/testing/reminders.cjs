'use strict'
/** 真实宿主中的提醒生命周期；固定日期不替换计时器，实际等待一轮分钟检查。 */
const fs = require('node:fs')
const path = require('node:path')
const { waitFor } = require('./road.cjs')
const { openBoard } = require('./panel.cjs')
const { captureAppearance } = require('./appearance.cjs')

async function remindersPass(page, check, home) {
  const evidence = path.resolve(__dirname, '../../.debug/evidence/T08')
  fs.mkdirSync(evidence, { recursive: true })
  const api = new URL('api/widget-board/', page.url()).href
  const call = async (suffix, data, method = 'POST') => {
    const response = await page.context().request.fetch(api + suffix, { method, ...(data === undefined ? {} : { data }) })
    const value = await response.json()
    if (!response.ok()) throw new Error(`${suffix}: HTTP ${response.status()} ${JSON.stringify(value)}`)
    return value
  }
  const original = (await call('boards', undefined, 'GET')).active
  await page.clock.setFixedTime(new Date('2026-10-26T00:59:00Z'))
  const board = (await call('boards', { title: 'T08提醒验收' })).id
  const make = (id, changes = {}) => ({ id, title: `提醒验收${id}`, kind: 'deadline', category: '', status: 'todo', due: { kind: 'date', date: '2026-10-26', timeZone: 'Asia/Shanghai' }, source: 'manual', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...changes })
  const state = { schemaVersion: 1, items: [make('one'), make('two')], links: [], customCategories: [], reminderLedger: {} }
  const id = (await call(`boards/${board}/compose`, { widget: 'campus', props: { reminderEnabled: true, reminderLeadHours: 0 }, state, layout: { x: 0, y: 0, w: 1, h: 22 } })).id
  const filler = (await call(`boards/${board}/compose`, { widget: 'markdown', props: {}, data: null, state: null, layout: { x: 0, y: 100, w: 1, h: 22 } })).id
  const content = () => call(`instance/${id}/content`, undefined, 'GET')
  const save = async changes => { const current = await content(); return call(`instance/${id}/content`, { expectedRevision: current.revision, ...changes }) }
  const card = page.locator(`[data-instance="${id}"]`).first()
  const fillerCard = page.locator(`[data-instance="${filler}"]`).first()
  const badgeCount = async () => page.locator('[data-dsh-widget-board-badge] .dsh-widget-board__badge-dot').textContent()
  let boardFile
  let backup
  try {
    await card.waitFor()
    await card.scrollIntoViewIfNeeded()
    let frame = await (await card.locator('iframe').elementHandle()).contentFrame()
    await frame.waitForFunction(() => window.widget?.state?.items?.length === 2 && !window.widget.paused)
    check('N02 09点前没有提醒记录', Object.keys((await content()).instance.state.reminderLedger).length === 0)
    await page.clock.setFixedTime(new Date('2026-10-26T01:00:00Z'))
    console.log('等待真实的一分钟提醒检查，不修改计时器或通知实现')
    check('N01 每分钟检查并在保存后通知', await waitFor(async () => Object.keys((await content()).instance.state.reminderLedger).length === 2 && await badgeCount() === '1', 65000))
    check('N05 多事项合并一条且未读提示包含摘要', (await page.locator('[data-dsh-widget-board-panel-icon]').getAttribute('title')).includes('2项'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openBoard(page)
    await card.waitFor()
    await card.scrollIntoViewIfNeeded()
    frame = await (await card.locator('iframe').elementHandle()).contentFrame()
    await frame.waitForFunction(() => window.widget?.state?.items?.length === 2)
    check('N04 普通刷新保留去重记录且不重复通知', Object.keys((await content()).instance.state.reminderLedger).length === 2 && await page.locator('[data-dsh-widget-board-badge]').getAttribute('data-open') !== 'true')
    await fillerCard.scrollIntoViewIfNeeded()
    check('N01 离屏时卡片暂停', await waitFor(() => frame.evaluate(() => window.widget.paused)))
    await save({ state: { ...state, items: [make('changed', { due: { kind: 'date', date: '2026-10-25', timeZone: 'Asia/Shanghai' } })] } })
    await frame.waitForFunction(() => window.widget.state.items[0]?.id === 'changed')
    check('N01 暂停时不写提醒记录', Object.keys((await content()).instance.state.reminderLedger).length === 0)
    await card.scrollIntoViewIfNeeded()
    check('N01 恢复补查且N04新截止版本可提醒', await waitFor(async () => Object.keys((await content()).instance.state.reminderLedger).length === 1 && await badgeCount() === '1'))
    await page.locator('[data-dsh-widget-board-panel-icon]').click()
    check('N07 点击现有入口清除未读', await waitFor(async () => await page.locator('[data-dsh-widget-board-badge]').getAttribute('data-open') === 'false'))
    await save({ props: { reminderEnabled: false, reminderLeadHours: 24 }, state: { ...state, items: [make('off')] } })
    await frame.waitForFunction(() => window.widget.props.reminderEnabled === false && window.widget.state.items[0]?.id === 'off')
    check('N03 关闭提醒不新增记录', Object.keys((await content()).instance.state.reminderLedger).length === 0)
    await save({ props: { reminderEnabled: true, reminderLeadHours: 24 }, state: { ...state, items: [make('done', { status: 'done' }), make('cancelled', { status: 'cancelled' })] } })
    await frame.waitForFunction(() => window.widget.state.items[0]?.status === 'done')
    check('N03 完成和取消不提醒', Object.keys((await content()).instance.state.reminderLedger).length === 0)
    const oldLedger = { 'old-deleted-version': '2026-10-26T00:00:00Z' }
    await save({ state: { ...state, items: [], reminderLedger: oldLedger } })
    check('N08 清理已删除事项及旧ledger', await waitFor(async () => Object.keys((await content()).instance.state.reminderLedger).length === 0))
    await frame.locator('[data-action="manage"]').click()
    await page.locator('[data-dsh-widget-campus-reminders]').waitFor()
    await captureAppearance(page, evidence, 'reminders', async (width, scheme) => {
      const settings = page.locator('[data-dsh-widget-campus-reminders]')
      await settings.scrollIntoViewIfNeeded()
      check(`提醒设置 ${width}/${scheme} 无横向溢出`, await settings.evaluate(element => element.scrollWidth <= element.clientWidth + 1))
    }, [1920, 1440, 1024, 640], width => width === 1024 ? 768 : 900)
    await page.locator('[data-dsh-widget-board-content-close]').click()
    if (home) {
      await page.setViewportSize({ width: 1440, height: 900 })
      await save({ state: { ...state, items: [make('failure', { due: { kind: 'date', date: '2030-01-01', timeZone: 'Asia/Shanghai' } })] } })
      await frame.waitForFunction(() => window.widget.state.items[0]?.id === 'failure')
      await fillerCard.scrollIntoViewIfNeeded()
      if (!await waitFor(() => frame.evaluate(() => window.widget.paused))) throw new Error('磁盘故障前卡片未暂停')
      if (!/^[a-zA-Z0-9-]+$/.test(board)) throw new Error('测试看板标识不合法')
      boardFile = path.join(home, 'widget-board', 'boards', `${board}.json`)
      backup = `${boardFile}.t08-original`
      fs.renameSync(boardFile, backup)
      fs.mkdirSync(boardFile)
      await page.clock.setFixedTime(new Date('2030-01-02T10:00:00Z'))
      await card.scrollIntoViewIfNeeded()
      check('N06 持久化失败可见且停止该轮通知', await waitFor(async () => (await frame.locator('[data-field="feedback"]').innerText()).includes('提醒记录尚未保存确认') && await page.locator('[data-dsh-widget-board-badge]').getAttribute('data-open') === 'false', 12000))
      await page.screenshot({ path: path.join(evidence, 'reminder-save-failure.png') })
      fs.rmdirSync(boardFile)
      fs.renameSync(backup, boardFile)
      backup = undefined
      check('N06 失败后不反复通知', await waitFor(async () => (await frame.locator('[data-field="feedback"]').innerText()).includes('停止本卡提醒') && await page.locator('[data-dsh-widget-board-badge]').getAttribute('data-open') === 'false'))
    }
  } finally {
    if (backup) { fs.rmdirSync(boardFile); fs.renameSync(backup, boardFile) }
    await page.clock.setFixedTime(new Date())
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    await call(`boards/${original}/activate`)
    await call(`boards/${board}/remove`)
  }
}
module.exports = { remindersPass }
