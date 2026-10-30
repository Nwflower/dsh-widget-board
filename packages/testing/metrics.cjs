'use strict'
const { centerCard, frameOf } = require('./frames.cjs')
const METRICS_FRAME = 'iframe.dsh-widget-board__frame[title="运行成本"]'

/**
 * 运行成本卡（issue #5）：数据源在真实宿主里返回完整结构，卡片把宿主、机器与看板的读数画出来。
 *
 * 不核对具体字节数：它随机器与当时的负载变化；只核对数据源结构、面板字段与文案接上了。
 *
 * @param page - 宿主页面，看板已经打开。
 */
async function metricsPass(page, check) {
  // 视口外的组件按暂停协议停止绘制，读取前先让卡片恢复可见。
  await centerCard(page, '运行成本')
  const frame = await frameOf(page, METRICS_FRAME)
  await frame.waitForSelector('.metrics[data-state="ready"]', { timeout: 30000 })
  const view = await frame.evaluate(() => ({
    rss: document.querySelector('[data-field="rss"]')?.textContent ?? '',
    unit: document.querySelector('[data-field="rssUnit"]')?.textContent ?? '',
    panelTitle: document.querySelector('[data-field="panelTitle"]')?.textContent ?? '',
    system: document.querySelector('[data-field="system"]')?.textContent ?? '',
    board: document.querySelector('[data-field="board"]')?.textContent ?? '',
    library: document.querySelector('[data-field="library"]')?.textContent ?? '',
  }))
  check('运行成本卡读到宿主读数', /^[\d.,]+$/.test(view.rss) && view.unit !== '', `${view.rss} ${view.unit}`)
  check('运行成本卡画出系统、看板与组件库', view.panelTitle !== '' && view.system !== '' && view.board !== '' && view.library !== '', `${view.panelTitle} / ${view.system} / ${view.board} / ${view.library}`)
  const data = await page.evaluate(async () => {
    const workspace = await (await fetch('api/widget-board/boards')).json()
    const board = workspace.boards.find((entry) => entry.id === workspace.active) ?? workspace.boards[0]
    return board.instances.find((entry) => entry.widget === 'system-metrics')?.data ?? null
  })
  check(
    '运行成本的数据源返回完整结构',
    data !== null && typeof data.host?.rss === 'number' && typeof data.host?.heapUsed === 'number' &&
      typeof data.system?.platform === 'string' && data.system.platform !== '' && typeof data.system?.cpus === 'number' &&
      typeof data.system?.totalMemory === 'number' && typeof data.readMs === 'number' &&
      typeof data.board?.cards === 'number' && typeof data.board?.stateBytes === 'number' &&
      typeof data.board?.documentsBytes === 'number' && typeof data.library?.widgets === 'number' &&
      typeof data.library?.versions === 'number' && data.host.rss > 0 && data.board.documentsBytes > 0 &&
      !Number.isNaN(Date.parse(data.sampledAt)),
    data === null ? '没有数据' : `rss ${data.host.rss} / ${data.system.platform} / cards ${data.board.cards} / docs ${data.board.documentsBytes}`,
  )
}

module.exports = { metricsPass }
