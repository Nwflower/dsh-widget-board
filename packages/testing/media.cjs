'use strict'
/** 真实页面：本地上传、实例图片、越权拒绝、备份与刷新。 */
const sharp = require('sharp')
const { openDockAction } = require('./library.cjs')
const { waitFor } = require('./road.cjs')
const fs = require('node:fs')
const path = require('node:path')
const { captureAppearance } = require('./appearance.cjs')

async function mediaPass(page, check) {
  const evidence = path.resolve(__dirname, '../../.debug/evidence/T05')
  fs.mkdirSync(evidence, { recursive: true })
  const original = await page.evaluate(async () => (await (await fetch('api/widget-board/boards')).json()).active)
  const board = await page.evaluate(async () => {
    const response = await fetch('api/widget-board/boards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '媒体验收' }) })
    if (!response.ok) throw new Error(await response.text())
    const created = await response.json()
    return created.id
  })
  const png = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#5d8197' } }).png().toBuffer()
  let imported
  try {
    await openDockAction(page, 'create')
    await page.locator('[data-dsh-widget-board-template="image"]').click()
    await page.locator('[data-dsh-widget-board-media-field] input[type="file"]').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png })
    check('本地图片上传及预览', await waitFor(async () => await page.locator('[data-dsh-widget-board-media-field] img').count() === 1, 15000))
    const previewImage = page.locator('[data-dsh-widget-board-image-preview] img')
    check('编辑器右侧受控图片预览', await waitFor(async () => await previewImage.count() === 1 && await previewImage.evaluate(image => image.naturalWidth > 0), 10000))
    await page.locator('[data-dsh-widget-board-field="alt"]').fill('媒体验收图片')
    await page.locator('[data-dsh-widget-board-field="caption"]').fill('受限图片备份')
    await page.screenshot({ path: path.join(evidence, 'image-editor.png') })
    await page.locator('[data-dsh-widget-board-composer-submit]').click()
    await page.locator('[data-dsh-widget-board-composer]').waitFor({ state: 'detached' })
    const instance = await page.evaluate(async id => {
      const snapshot = await (await fetch('api/widget-board/boards')).json()
      return snapshot.boards.find(board => board.id === id).instances[0]
    }, board)
    check('图片只保存资源hash', /^[0-9a-f]{64}$/.test(instance.media?.background ?? '') && !JSON.stringify(instance.props).includes('base64'))
    const imageReady = async (id, expectedWidth = 640) => {
      const card = page.locator(`[data-instance="${id}"]`).first()
      await card.scrollIntoViewIfNeeded()
      const handle = await card.locator('iframe').elementHandle()
      const frame = await handle.contentFrame()
      await frame.waitForFunction(width => { const image = document.querySelector('[data-role="img"]'); return image && !image.hidden && image.naturalWidth === width }, expectedWidth, { timeout: 15000 })
      return await frame.evaluate(() => ({ width: document.querySelector('[data-role="img"]').naturalWidth, src: document.querySelector('[data-role="img"]').src }))
    }
    const ready = await imageReady(instance.id)
    check('沙箱逐块读取并使用对象URL', ready.width === 640 && ready.src.startsWith('blob:'))
    const imageHandle = await page.locator(`[data-instance="${instance.id}"] iframe`).elementHandle()
    const imageFrame = await imageHandle.contentFrame()
    await imageFrame.evaluate(() => {
      window.__mediaRevoked = []
      const revoke = URL.revokeObjectURL.bind(URL)
      URL.revokeObjectURL = value => { window.__mediaRevoked.push(value); revoke(value) }
    })
    await page.evaluate(async original => { await fetch(`api/widget-board/boards/${original}/activate`, { method: 'POST' }) }, original)
    const released = await waitFor(async () => {
      if (imageFrame.isDetached()) return true
      try { return await imageFrame.evaluate(() => window.widget.paused && window.__mediaRevoked.length > 0) } catch (error) {
        if (imageFrame.isDetached() && !page.isClosed()) return true
        throw error
      }
    }, 10000)
    check('切离看板暂停或卸载并释放图片URL', released)
    await page.evaluate(async board => { await fetch(`api/widget-board/boards/${board}/activate`, { method: 'POST' }) }, board)
    check('恢复看板重新读取图片', (await imageReady(instance.id)).width === 640)
    await captureAppearance(page, evidence, 'image')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.locator(`[data-instance="${instance.id}"] [data-dsh-widget-board-handle="settings"]`).click()
    await page.locator('[data-dsh-widget-board-editor-content]').click()
    check('已有图片进入内容编辑可预览', await waitFor(async () => await page.locator('[data-dsh-widget-board-image-preview] img').count() === 1 && await page.locator('[data-dsh-widget-board-image-preview] img').evaluate(image => image.naturalWidth === 640), 10000))
    const replacement = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#647c65' } }).png().toBuffer()
    const changed = await page.evaluate(async ({ id, bytes }) => {
      const post = async (path, body) => {
        const response = await fetch(`api/widget-board/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        const value = await response.json()
        if (!response.ok) throw new Error(JSON.stringify(value))
        return value
      }
      const { session } = await post('media/sessions', { target: id })
      const response = await fetch(`api/widget-board/media?session=${session}&role=background`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array(bytes) })
      const uploaded = await response.json()
      if (!response.ok) throw new Error(JSON.stringify(uploaded))
      const model = await (await fetch(`api/widget-board/instance/${id}/content`)).json()
      await post(`instance/${id}/content`, { expectedRevision: model.revision, props: model.instance.props, data: { ...model.instance.data, caption: '另一窗口更换图片' }, media: { background: uploaded.ref }, mediaSession: session, mediaTickets: { background: uploaded.uploadTicket } })
      return uploaded.ref
    }, { id: instance.id, bytes: [...replacement] })
    instance.media.background = changed
    await page.locator('[data-dsh-widget-board-field="caption"]').fill('未提交的本地说明')
    await page.locator('[data-dsh-widget-board-content-save]').click()
    await page.locator('[data-dsh-widget-board-content-reload]').click()
    check('冲突重新读取后预览更新到新图片', await waitFor(async () => await page.locator('[data-dsh-widget-board-image-preview] img').evaluate(image => image.naturalWidth === 320), 10000))
    await page.locator('[data-dsh-widget-board-content-close]').click()
    await page.keyboard.press('Escape')
    const denied = await page.evaluate(async ({ board, ref }) => {
      const post = async (path, body) => await fetch(`api/widget-board/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const created = await (await post(`boards/${board}/compose`, { widget: 'image', props: {}, data: null, state: null })).json()
      const bound = await post(`instance/${created.id}/content`, { expectedRevision: created.snapshot.boards.find(item => item.id === board).revision, media: { background: ref } })
      const read = await post(`instance/${created.id}/call`, { capability: 'widget-board:media.read', args: { ref, offset: 0, length: 1 } })
      await post(`instance/${created.id}/remove`, {})
      return { bind: bound.status, read: read.status }
    }, { board, ref: instance.media.background })
    check('已知外卡hash不能绑定或读取', denied.bind === 403 && denied.read !== 200, JSON.stringify(denied))
    const backup = await page.evaluate(async board => {
      const exported = await fetch(`api/widget-board/boards/${board}/export?data=true`)
      if (!exported.ok) throw new Error(await exported.text())
      const bytes = await exported.arrayBuffer()
      const response = await fetch('api/widget-board/boards/import', { method: 'POST', body: bytes })
      const body = await response.json()
      if (!response.ok) throw new Error(JSON.stringify(body))
      return body
    }, board)
    imported = backup.board
    check('含图片备份导入使用新实例id', backup.cards.length === 1 && backup.cards[0] !== instance.id)
    check('导入图片恢复', (await imageReady(backup.cards[0], 320)).width === 320)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const { openBoard } = require('./panel.cjs')
    await openBoard(page)
    check('刷新后图片恢复', (await imageReady(backup.cards[0], 320)).width === 320)
  } finally {
    await page.evaluate(async ({ board, imported, original }) => {
      for (const id of [board, imported].filter(Boolean)) await fetch(`api/widget-board/boards/${id}/remove`, { method: 'POST' })
      await fetch(`api/widget-board/boards/${original}/activate`, { method: 'POST' })
    }, { board, imported, original })
  }
}
module.exports = { mediaPass }
