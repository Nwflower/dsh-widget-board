#!/usr/bin/env node
'use strict'
/**
 * share.cjs — 分享与导入（D8）：组件库里有导出入口，导出得到的字节能再导入回来；看板导出的包里
 * 带着它用到的组件。
 *
 * 与看板的打开方式一起使用：页面已经停在看板上时调用。
 */
const { openLibrary } = require('./library.cjs')

/**
 * 导出内置组件再导入回来，再读一遍看板导出的包。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param check - 记一条判据的函数。
 */
async function sharePass(page, check) {
  await openLibrary(page)
  // 显式挑一个内置组件：组件库按角色分区，示例区排在前面，第一个导出入口落不到内置组件上（D17）。
  const link = await page.waitForSelector('[data-dsh-widget-board-export="weather"]', { timeout: 15000 })
  const id = await link.getAttribute('data-dsh-widget-board-export')
  check('组件库里有导出入口', typeof id === 'string' && id !== '', String(id))
  const roundTrip = await page.evaluate(async (widget) => {
    const exported = await fetch(`api/widget-board/library/widget/${encodeURIComponent(widget)}/export`)
    const bytes = await exported.arrayBuffer()
    const imported = await fetch('api/widget-board/library/import?replace=true', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: bytes,
    })
    return { exportStatus: exported.status, type: exported.headers.get('content-type'), bytes: bytes.byteLength, importStatus: imported.status, body: await imported.json() }
  }, id)
  check('导出的响应是 zip', roundTrip.exportStatus === 200 && roundTrip.type === 'application/zip' && roundTrip.bytes > 0, `${roundTrip.exportStatus} ${roundTrip.type} ${roundTrip.bytes}`)
  // 导出的是内置组件：包能解开（否则报的是「不是有效的组件包」），但内置组件不许被覆盖（D8、D17）。
  check('内置组件的包能解开但不会被覆盖', roundTrip.importStatus === 400 && String(roundTrip.body.error).includes('是内置的'), `${roundTrip.importStatus} ${JSON.stringify(roundTrip.body).slice(0, 80)}`)

  const board = await page.evaluate(async () => {
    const snapshot = await (await fetch('api/widget-board/boards')).json()
    const exported = await fetch(`api/widget-board/boards/${encodeURIComponent(snapshot.active)}/export`)
    const pkg = await exported.json()
    return { status: exported.status, cards: Array.isArray(pkg.cards) ? pkg.cards.length : -1, widgets: Array.isArray(pkg.widgets) ? pkg.widgets.length : -1 }
  })
  check('看板导出带着卡片与用到的组件', board.status === 200 && board.cards > 0 && board.widgets > 0, JSON.stringify(board))
  await page.keyboard.press('Escape')
}

module.exports = { sharePass }
