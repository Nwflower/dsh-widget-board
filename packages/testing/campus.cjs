'use strict'
/** 真实宿主中的校园卡创建、日期、状态、管理、冲突及布局。 */
const fs = require('node:fs')
const path = require('node:path')
const { openDockAction } = require('./library.cjs')
const { waitFor } = require('./road.cjs')
const { setCardHeight } = require('./board.cjs')
const sharp = require('sharp')
const { captureAppearance } = require('./appearance.cjs')
const { itemExchangePass } = require('./item-exchange.cjs')
async function campusPass(page, check) {
  const evidence = path.resolve(__dirname, '../../.debug/evidence/T06')
  fs.mkdirSync(evidence, { recursive: true })
  const original = await page.evaluate(async () => (await (await fetch('api/widget-board/boards')).json()).active)
  const board = await page.evaluate(async () => {
    const response = await fetch('api/widget-board/boards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '校园验收' }) })
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()).id
  })
  const content = async id => await page.evaluate(async id => await (await fetch(`api/widget-board/instance/${id}/content`)).json(), id)
  const save = async (id, changes) => await page.evaluate(async ({ id, changes }) => {
    const model = await (await fetch(`api/widget-board/instance/${id}/content`)).json()
    const response = await fetch(`api/widget-board/instance/${id}/content`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: model.revision, ...changes }) })
    return { ok: response.ok, status: response.status, value: await response.json() }
  }, { id, changes })
  try {
    await openDockAction(page, 'create')
    await page.locator('[data-dsh-widget-board-template="campus"]').click()
    await page.locator('[data-dsh-widget-campus-form]').waitFor()
    await page.locator('[data-dsh-widget-campus-reminders] input[type="checkbox"]').uncheck()
    check('校园卡创建默认空白', await page.locator('[data-dsh-widget-campus-form]').innerText().then(text => text.includes('还没有事项') || text.includes('No items')))
    await page.locator('[data-dsh-widget-campus-add]').click()
    await page.locator('[data-dsh-widget-campus-field="title"]').fill('校园验收事项')
    await page.locator('[data-dsh-widget-campus-field="date"]').fill('2020-01-01')
    await page.locator('[data-dsh-widget-campus-confirm-item]').click()
    await page.locator('[data-dsh-widget-board-composer-submit]').click()
    await page.locator('[data-dsh-widget-board-composer]').waitFor({ state: 'detached' })
    const instance = await page.evaluate(async id => (await (await fetch('api/widget-board/boards')).json()).boards.find(board => board.id === id).instances[0], board)
    const beforeRefusal = await content(instance.id)
    const originalItem = instance.state.items[0]
    const invalidStates = [
      ['不存在的日期', { ...instance.state, items: [{ ...originalItem, due: { kind: 'date', date: '2026-02-30', timeZone: 'Asia/Shanghai' } }] }],
      ['无效的事项时区', { ...instance.state, items: [{ ...originalItem, due: { ...originalItem.due, timeZone: 'Invalid/Zone' } }] }],
      ['重复事项标识', { ...instance.state, items: [originalItem, originalItem] }],
      ['危险的入口协议', { ...instance.state, links: [{ id: 'unsafe', title: '不合法入口', url: 'javascript:alert(1)' }] }],
    ]
    for (const [label, state] of invalidStates) {
      const rejected = await save(instance.id, { state })
      const after = await content(instance.id)
      check(`宿主拒绝${label}且保留原内容`, rejected.status === 400 && after.revision === beforeRefusal.revision && JSON.stringify(after.instance) === JSON.stringify(beforeRefusal.instance))
    }
    const badZone = await save(instance.id, { props: { ...instance.props, timeZone: 'Invalid/Zone' } })
    check('宿主拒绝配置中的无效时区', badZone.status === 400 && badZone.value.subject === 'props')
    const rejectedCreation = await page.evaluate(async ({ board, props, state }) => {
      const snapshot = async () => (await (await fetch('api/widget-board/boards')).json()).boards.find(entry => entry.id === board).instances.length
      const before = await snapshot()
      const response = await fetch(`api/widget-board/boards/${board}/compose`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ widget: 'campus', props, state }) })
      return response.status === 400 && before === await snapshot()
    }, { board, props: instance.props, state: invalidStates[0][1] })
    check('宿主创建路径拒绝非法日期且无残留实例', rejectedCreation)
    const card = page.locator(`[data-instance="${instance.id}"]`).first()
    const frame = await (await card.locator('iframe').elementHandle()).contentFrame()
    await frame.waitForSelector('.campus__item-title')
    check('沙箱独立脚本显示真实事项和超期文字', (await frame.locator('.campus').innerText()).includes('校园验收事项') && (await frame.locator('.campus').innerText()).match(/超期|Overdue/))
    await frame.locator('[data-item-id]').click()
    check('卡面完成等待宿主确认', await waitFor(async () => (await content(instance.id)).instance.state.items[0].status === 'done', 10000))
    await frame.locator('[data-action="manage"]').click()
    await page.locator('[data-dsh-widget-board-content-editor]').waitFor()
    await page.locator('[data-dsh-widget-campus-tab="appearance"]').click()
    await page.locator('[data-dsh-widget-campus-school]').selectOption('bit')
    await page.locator('[data-dsh-widget-campus-degree]').selectOption('doctoral')
    await save(instance.id, { props: { ...instance.props, degree: 'undergraduate' } })
    await page.locator('[data-dsh-widget-board-content-save]').click()
    await page.locator('[data-dsh-widget-board-content-stale]').waitFor()
    check('校园编辑冲突保留本地草稿', await page.locator('[data-dsh-widget-campus-degree]').inputValue() === 'doctoral')
    await page.locator('[data-dsh-widget-board-content-reload]').click()
    if (!await waitFor(async () => await page.locator('[data-dsh-widget-campus-degree]').inputValue() === 'undergraduate', 10000)) throw new Error('冲突重读未完成')
    await page.locator('[data-dsh-widget-campus-degree]').selectOption('master')
    await page.locator('[data-dsh-widget-board-content-save]').click()
    if (!await waitFor(async () => (await content(instance.id)).instance.props.degree === 'master', 10000)) throw new Error('保存未确认')
    await page.locator('[data-dsh-widget-board-content-close]').click()
    await frame.locator('[data-action="manage"]').click()
    await page.locator('[data-dsh-widget-campus-form] details summary').click()
    const itemRow = page.locator(`[data-dsh-widget-campus-item="${instance.state.items[0].id}"]`)
    await itemRow.getByRole('button', { name: '恢复', exact: true }).click()
    await itemRow.getByRole('button', { name: '编辑', exact: true }).click()
    await page.locator('[data-dsh-widget-campus-field="title"]').fill('修改后的校园事项')
    await page.locator('[data-dsh-widget-campus-confirm-item]').click()
    await itemRow.getByRole('button', { name: '取消事项', exact: true }).click()
    await page.locator('[data-dsh-widget-campus-form] details summary').click()
    await itemRow.getByRole('button', { name: '恢复', exact: true }).click()
    await itemRow.getByRole('button', { name: '完成', exact: true }).click()
    await page.locator('[data-dsh-widget-campus-tab="links"]').click()
    for (const [title, url] of [['入口甲', 'https://www.bit.edu.cn/'], ['入口乙', 'https://www.xmu.edu.cn/']]) {
      await page.locator('[data-dsh-widget-campus-link-title]').fill(title)
      await page.locator('[data-dsh-widget-campus-link-url]').fill(url)
      await page.locator('[data-dsh-widget-campus-link-save]').click()
    }
    await page.getByRole('button', { name: '上移 入口乙', exact: true }).click()
    await page.locator('[data-dsh-widget-board-content-save]').click()
    check('事项修改完成恢复取消及键盘链接排序保存', await waitFor(async () => { const saved = (await content(instance.id)).instance.state; return saved.items[0].title === '修改后的校园事项' && saved.items[0].status === 'done' && saved.links[0].title === '入口乙' }, 10000))
    await page.locator('[data-dsh-widget-campus-tab="items"]').click()
    await page.locator('[data-dsh-widget-campus-add]').click()
    await page.locator('[data-dsh-widget-campus-field="title"]').fill('可删除的临时事项')
    await page.locator('[data-dsh-widget-campus-field="date"]').fill('2030-01-01')
    await page.locator('[data-dsh-widget-campus-confirm-item]').click()
    const disposable = page.locator('[data-dsh-widget-campus-item]').filter({ hasText: '可删除的临时事项' })
    await disposable.getByRole('button', { name: '删除', exact: true }).click()
    check('事项删除先轻量确认', await disposable.count() === 1)
    await disposable.getByRole('button', { name: '确认删除', exact: true }).click()
    check('确认后仅移除指定事项', await disposable.count() === 0 && await page.locator('[data-dsh-widget-campus-item]').count() === 1)
    await page.locator('[data-dsh-widget-board-content-close]').click()
    // 删除临时项后内容与已保存版本相同，直接关闭。
    for (const schoolPreset of ['bupt', 'bit', 'xmu', 'csu']) {
      for (const degree of ['undergraduate', 'master', 'doctoral']) {
        const model = await content(instance.id)
        const result = await save(instance.id, { props: { ...model.instance.props, schoolPreset, degree } })
        const ready = await waitFor(async () => await frame.evaluate(({ schoolPreset, degree }) => window.widget?.props.schoolPreset === schoolPreset && window.widget?.props.degree === degree, { schoolPreset, degree }), 10000)
        check(`学校与身份 ${schoolPreset}/${degree} 保留事项`, result.ok && ready && result.value.state.items[0].status === 'done')
      }
    }
    check('校园原创图案真实加载', await frame.locator('[data-pattern="mountain"]').evaluate(image => image.naturalWidth > 0))
    for (const genericTheme of ['book', 'tree', 'clock']) {
      const model = await content(instance.id)
      await save(instance.id, { props: { ...model.instance.props, schoolPreset: 'generic', genericTheme } })
      check(`通用图案 ${genericTheme}`, await waitFor(async () => await frame.locator(`[data-pattern="${genericTheme}"]`).evaluate(image => !image.hidden && image.naturalWidth > 0), 10000))
    }
    const model = await content(instance.id)
    const customProps = { ...model.instance.props, schoolPreset: 'custom', customSchool: { name: '我的自定义学校', shortName: '我的学校', iconAlt: '我的学校图标' }, hasBackground: true, hasIcon: true }
    await save(instance.id, { props: customProps })
    const unavailable = await waitFor(async () => (await frame.locator('[data-field="school"]').innerText()) === '我的自定义学校' && /不可用|unavailable/.test(await frame.locator('[data-field="feedback"]').innerText()), 10000)
    const mediaView = await frame.evaluate(() => ({ school: document.querySelector('[data-field="school"]').textContent, feedback: document.querySelector('[data-field="feedback"]').textContent, paused: window.widget.paused, props: window.widget.props }))
    check('自定义学校和不可用媒体保持可管理', unavailable, JSON.stringify(mediaView))
    const missingMediaState = (await content(instance.id)).instance.state
    await save(instance.id, { state: { ...missingMediaState, customCategories: ['回归分类'] } })
    await frame.waitForFunction(() => window.widget.state.customCategories.includes('回归分类'))
    check('普通状态更新保留缺失媒体提示', /不可用|unavailable/.test(await frame.locator('[data-field="feedback"]').innerText()))
    const state = (await content(instance.id)).instance.state
    const items = Array.from({ length: 100 }, (_, index) => ({ ...state.items[0], id: `item-${index}`, status: 'todo', kind: index < 2 ? 'milestone' : 'deadline', title: `事项 ${index} ${'长标题'.repeat(15)}` }))
    const hundred = await save(instance.id, { state: { ...state, items } })
    check('一百条真实保存且超限拒绝', hundred.ok && !(await save(instance.id, { state: { ...state, items: [...items, { ...items[0], id: 'overflow' }] } })).ok)
    check('64KiB 状态被拒绝', !(await save(instance.id, { state: { ...state, items: items.map(item => ({ ...item, note: '中'.repeat(500) })) } })).ok)
    check('最早超期里程碑不被跳过，分母真实', await waitFor(async () => (await frame.locator('[data-field="next"]').innerText()).match(/超期|Overdue/) && (await frame.locator('[data-field="progress"]').innerText()) === '0/2', 10000))
    const duplicate = await page.evaluate(async ({ board, props }) => {
      const response = await fetch(`api/widget-board/boards/${board}/compose`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ widget: 'campus', props, state: null }) })
      if (!response.ok) throw new Error(await response.text())
      return (await response.json()).id
    }, { board, props: { ...model.instance.props, schoolPreset: 'bit' } })
    check('多实例状态独立', (await content(duplicate)).instance.state === null && (await content(instance.id)).instance.state.items.length === 100)
    await page.evaluate(async id => { await fetch(`api/widget-board/instance/${id}/remove`, { method: 'POST' }) }, duplicate)
    await frame.locator('[data-action="manage"]').click()
    await page.locator('[data-dsh-widget-campus-tab="appearance"]').click()
    const png = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#171b24' } }).png().toBuffer()
    const fields = page.locator('[data-dsh-widget-board-media-field] input[type="file"]')
    await fields.nth(0).setInputFiles({ name: 'background.png', mimeType: 'image/png', buffer: png })
    if (!await waitFor(async () => await page.locator('[data-dsh-widget-board-media-field] img').count() === 1, 10000)) throw new Error('背景上传未完成')
    await fields.nth(1).setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: png })
    if (!await waitFor(async () => await page.locator('[data-dsh-widget-board-media-field] img').count() === 2, 10000)) throw new Error('图标上传未完成')
    await page.screenshot({ path: path.join(evidence, 'campus-management.png') })
    await page.locator('[data-dsh-widget-board-content-save]').click()
    check('背景与图标同次原子保存', await waitFor(async () => { const value = (await content(instance.id)).instance; return Boolean(value.media?.background && value.media?.icon) }, 10000))
    await page.locator('[data-dsh-widget-board-content-close]').click()
    check('校园媒体由沙箱读取', await waitFor(async () => await frame.locator('[data-media="background"]').evaluate(image => !image.hidden && image.naturalWidth === 640), 10000))
    await setCardHeight(page, instance.id, 14)
    check('14rem 摘要保留事项与管理入口', await waitFor(async () => await frame.locator('[data-action="manage"]').evaluate(button => button.getBoundingClientRect().bottom <= innerHeight) && await frame.locator('.campus__item-title').count() > 0, 10000))
    await setCardHeight(page, instance.id, 22)
    await captureAppearance(page, evidence, 'campus', async (width, scheme) => {
      await card.scrollIntoViewIfNeeded()
      check(`校园卡 ${width}/${scheme} 按钮完整`, await frame.locator('[data-action="manage"]').evaluate(button => { const box = button.getBoundingClientRect(); return box.width > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight }))
    })
    await itemExchangePass(page, check, board, model.instance.props)
  } catch (error) {
    await page.screenshot({ path: path.join(evidence, 'failure.png') })
    throw error
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.evaluate(async ({ board, original }) => {
      await fetch(`api/widget-board/boards/${original}/activate`, { method: 'POST' })
      await fetch(`api/widget-board/boards/${board}/remove`, { method: 'POST' })
    }, { board, original })
  }
}
module.exports = { campusPass }
