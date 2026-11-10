'use strict'
/** 真实宿主文件交换：接口只写合成实例，界面以真实上传和下载走完往返。 */
const fs = require('node:fs')
const path = require('node:path')
const { waitFor } = require('./road.cjs')
const { captureAppearance } = require('./appearance.cjs')
async function itemExchangePass(page, check, board, props) {
  const evidence = path.resolve(__dirname, '../../.debug/evidence/T07')
  fs.mkdirSync(evidence, { recursive: true })
  const id = await page.evaluate(async ({ board, props }) => {
    const response = await fetch(`api/widget-board/boards/${board}/compose`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ widget: 'campus', props, state: null }) })
    if (!response.ok) throw new Error(await response.text())
    return (await response.json()).id
  }, { board, props })
  try {
    const results = await (async () => {
      const assertions = []
      const check = (label, value) => assertions.push([label, Boolean(value)])
      const call = async (suffix, body, method = 'POST') => {
        const response = await page.context().request.fetch(new URL(`api/widget-board/instance/${id}${suffix}`, page.url()).href, { method, ...(body === undefined ? {} : { data: body }) })
        return { status: response.status(), value: await response.json() }
      }
      const content = async () => (await call('/content', undefined, 'GET')).value
      const request = { format: 'csv', text: 'title,due,dateOnly,uid\n接口事项,2030-01-01,true,one', timeZone: 'Asia/Shanghai', mapping: { title: 'title', due: 'due', dateOnly: 'dateOnly', uid: 'uid' }, mappingConfirmed: true }
      const preview = async extra => (await call('/items/import-preview', { ...request, ...extra })).value
      const commit = async (model, decisions = {}) => call('/items/import-commit', { previewId: model.previewId, expectedRevision: model.revision, decisions })
      const before = await content()
      const first = await preview()
      check('预览不产生正式写入', (await content()).revision === before.revision)
      check('确认原子导入', (await commit(first)).status === 200 && (await content()).instance.state.items.length === 1)
      const repeated = await preview()
      check('相同UID默认跳过', repeated.rows[0].duplicateId && repeated.selected === 0)
      check('保留两条', (await commit(repeated, { 1: 'keep' })).status === 200 && (await content()).instance.state.items.length === 2)
      const stale = await preview({ text: request.text.replace('one', 'two') })
      const current = await content()
      await call('/content', { expectedRevision: current.revision, state: current.instance.state })
      check('并发409且无部分导入', (await commit(stale)).status === 409 && (await content()).instance.state.items.length === 2)
      await call(`/items/import-preview/${stale.previewId}`, undefined, 'DELETE')
      const cancelled = await preview()
      await call(`/items/import-preview/${cancelled.previewId}`, undefined, 'DELETE')
      check('取消后无法提交', (await commit(cancelled)).status === 404)
      check('2MiB文件拒绝', (await call('/items/import-preview', { ...request, text: '中'.repeat(700000) })).status === 413)
      const overflow = await preview({ text: 'title,due,dateOnly\n' + Array.from({ length: 101 }, (_, index) => `容量${index},2030-01-01,true`).join('\n'), mapping: { title: 'title', due: 'due', dateOnly: 'dateOnly' } })
      check('100条限制在预览和提交双重拒绝', overflow.errors.length > 0 && (await commit(overflow)).status === 413 && (await content()).instance.state.items.length === 2)
      await call(`/items/import-preview/${overflow.previewId}`, undefined, 'DELETE')
      const tooBig = await preview({ text: 'title,due,dateOnly,note\n' + Array.from({ length: 90 }, (_, index) => `字节${index},2030-01-01,true,${'中'.repeat(400)}`).join('\n'), mapping: { title: 'title', due: 'due', dateOnly: 'dateOnly', note: 'note' } })
      check('64KiB限制拒绝且无部分导入', tooBig.stateBytes > 65536 && (await commit(tooBig)).status === 413 && (await content()).instance.state.items.length === 2)
      await call(`/items/import-preview/${tooBig.previewId}`, undefined, 'DELETE')
      // 清空合成实例，随后从界面完成独立往返。
      const last = await content()
      await call('/content', { expectedRevision: last.revision, state: { ...last.instance.state, items: [] } })
      return assertions
    })()
    for (const [label, value] of results) check(`T07 ${label}`, value)
    const card = page.locator(`[data-instance="${id}"]`).first()
    await card.scrollIntoViewIfNeeded()
    const frame = await (await card.locator('iframe').elementHandle()).contentFrame()
    await frame.locator('[data-action="manage"]').click()
    const exchange = page.locator('[data-dsh-widget-campus-exchange]')
    await exchange.locator(':scope > summary').click()
    await exchange.locator('input[type=file]').setInputFiles({ name: '演示.csv', mimeType: 'text/csv', buffer: Buffer.from('\ufeff标题,截止日期,全天\r\n文件往返验收,2030-01-01,true') })
    await exchange.getByText('确认以上字段映射', { exact: true }).waitFor()
    await exchange.getByText('确认以上字段映射', { exact: true }).check()
    await exchange.getByRole('button', { name: '重新解析与匹配', exact: true }).click()
    await exchange.getByRole('button', { name: '确认一次导入 1 项', exact: true }).waitFor()
    check('T07 文件上传预览不写入', await page.evaluate(async id => (await (await fetch(`api/widget-board/instance/${id}/content`)).json()).instance.state.items.length === 0, id))
    await captureAppearance(page, evidence, 'preview', async (width, scheme) => {
      await exchange.scrollIntoViewIfNeeded()
      check(`T07 ${width}/${scheme} 预览无横向溢出`, await exchange.evaluate(element => element.scrollWidth <= element.clientWidth + 1))
    }, [1920, 1440, 1024, 640], width => width === 1024 ? 768 : 900)
    await page.setViewportSize({ width: 1440, height: 900 })
    await exchange.getByRole('button', { name: '确认一次导入 1 项', exact: true }).click()
    check('T07 界面确认保存成功', await waitFor(async () => await page.evaluate(async id => (await (await fetch(`api/widget-board/instance/${id}/content`)).json()).instance.state.items.length === 1, id)))
    for (const format of ['CSV', 'ICS']) {
      await exchange.getByRole('button', { name: `导出 ${format}`, exact: true }).click()
      const confirmation = exchange.getByRole('button', { name: `确认下载 campus.${format.toLowerCase()} （1项）`, exact: true })
      await confirmation.waitFor()
      const download = page.waitForEvent('download')
      await confirmation.click()
      const artifact = await download
      const saved = path.join(evidence, artifact.suggestedFilename())
      await artifact.saveAs(saved)
      await exchange.locator('input[type=file]').setInputFiles(saved)
      if (format === 'CSV') {
        await exchange.getByText('确认以上字段映射', { exact: true }).check()
        await exchange.getByRole('button', { name: '重新解析与匹配', exact: true }).click()
      }
      await exchange.getByRole('status').filter({ hasText: '重复' }).waitFor()
      check(`T07 ${format}真实下载再上传识别重复`, (await exchange.innerText()).includes('重复 1'))
      await exchange.getByRole('button', { name: '取消导入', exact: true }).click()
    }
    await page.locator('[data-dsh-widget-board-content-close]').click()
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.evaluate(async id => { await fetch(`api/widget-board/instance/${id}/remove`, { method: 'POST' }) }, id)
  }
}
module.exports = { itemExchangePass }
