'use strict'
/** 通过源码面板中的真实 iframe 触发副作用并检查端口生命周期。 */
const { openSource } = require('./source.cjs')
const { waitFor } = require('./road.cjs')

async function previewIsolationPass(page, check) {
  const id = 'user-preview-probe'
  const response = await page.evaluate(async (id) => {
    const response = await fetch('api/widget-board/library/define', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, manifest: { id, title: { zh: '预览验收', en: 'Preview check' }, version: '0.1.0', sizes: ['s'], actions: [{ id: 'system-metrics' }], capabilities: ['widget-board:media.read'] }, files: {
        'index.html': '<button id="probe">执行预览检查</button><p id="result">等待</p>',
        'style.css': 'body{color:var(--w-color-fg);background:var(--w-color-bg)}',
        'main.js': `window.widget.onState((state) => { document.getElementById('result').textContent = String(state?.count ?? 0) }); document.getElementById('probe').addEventListener('click', () => { document.getElementById('probe').textContent = '执行中'; window.widget.action('system-metrics'); window.widget.notify({title:'预览隔离验收'}); window.widget.setState({count:7}); window.widget.call('widget-board:media.read', {ref:'test'}).catch((error) => { document.getElementById('probe').textContent = '调用已拒绝：' + error.message }) })`,
      } }),
    })
    return { status: response.status, body: await response.text() }
  }, id)
  check('建立真实预览检查组件', response.status === 201, response.body.slice(0, 120))
  if (response.status !== 201) return
  await openSource(page, id)
  const locator = '[data-dsh-widget-board-preview-frame]'
  const preview = page.frameLocator(locator)
  await preview.locator('#probe').waitFor({ timeout: 20000 })
  await preview.locator('html[data-placement="preview"]').waitFor({ timeout: 10000 })
  const before = await page.evaluate(async () => await (await fetch('api/widget-board/boards')).text())
  const writes = []
  const listener = (request) => {
    if (request.method() === 'POST' && /\/instance\/.*\/(action|call|state|notify)/.test(request.url())) writes.push(request.url())
  }
  page.on('request', listener)
  try {
    await preview.locator('#probe').click()
    await preview.locator('#probe').filter({ hasText: '调用已拒绝' }).waitFor({ timeout: 10000 })
    check('预览状态可更新到沙箱画面', await waitFor(async () => await preview.locator('#result').textContent() === '7', 5000))
    check('预览 action、call、state 没有进入正式路由', writes.length === 0, writes.join(','))
    const after = await page.evaluate(async () => await (await fetch('api/widget-board/boards')).text())
    check('预览交互不改变正式工作区', before === after)
    const src = await page.locator(locator).getAttribute('src')
    await page.locator('[data-dsh-widget-board-preview-width="wide"]').click()
    await page.locator('[data-dsh-widget-board-preview-height="tall"]').click()
    check('尺寸切换不重载文档也不丢预览状态', await page.locator(locator).getAttribute('src') === src && await preview.locator('#result').textContent() === '7')
    const frame = await (await page.locator(locator).elementHandle()).contentFrame()
    for (const scheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: scheme })
      check(`预览跟随宿主${scheme}配色`, await waitFor(async () => {
        const expected = await page.locator('[data-dsh-widget-board-view]').evaluate((element) => getComputedStyle(element).getPropertyValue('--dsw-alias-bg-base').trim())
        const actual = await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--w-color-bg').trim())
        return expected !== '' && expected === actual
      }, 5000))
    }
    check('主题切换仍保留预览状态', await preview.locator('#result').textContent() === '7')
    const sandbox = await page.locator(locator).getAttribute('sandbox')
    check('真实预览仅有 allow-scripts', sandbox === 'allow-scripts', String(sandbox))
    await page.locator('[data-dsh-widget-board-source-close]').click()
    const path = src?.split('?')[0]
    check('关闭面板释放当前预览会话', await waitFor(async () => await page.evaluate(async (path) => (await fetch(path)).status, path) === 404, 10000))
    await page.locator('[data-dsh-widget-board-composer-close]').click()
    const discard = page.locator('[data-dsh-widget-board-composer-discard]')
    if (await discard.count() > 0) await discard.click()
  } finally { page.off('request', listener) }
}

module.exports = { previewIsolationPass }
