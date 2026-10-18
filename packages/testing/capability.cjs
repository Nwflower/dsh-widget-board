#!/usr/bin/env node
'use strict'
/**
 * capability.cjs — 宿主能力桥的真实宿主检查（D24）。
 *
 * 看板第一次启动会铺一张 DSH 余额卡；它声明 `dsh.account.balance`，组件用 `widget.call` 经宿主路由
 * 读当前登录账号的钱包。临时宿主可能没登录，所以判据是「拿到了 ready 或可见的失败」，而不是一定有
 * 余额。只认插件自己写在节点上的标记与组件文档里的 `data-state`。
 */
const { frameOf } = require('./frames.cjs')

/**
 * 找一张 DSH 余额卡，读它经能力桥拿到的状态。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param check - 记一条判据的函数。
 */
async function capabilityPass(page, check) {
  const id = await page.evaluate(async () => {
    const snapshot = await (await fetch('api/widget-board/boards')).json()
    return snapshot.boards.flatMap((board) => board.instances)
      .find((instance) => instance.widget === 'dsh-balance')?.id ?? ''
  })
  check('看板上有一张 DSH 余额卡', id !== '')
  if (id === '') return
  const card = `[data-instance="${id}"]`
  const frame = await frameOf(page, `${card} iframe.dsh-widget-board__frame[title="DSH 余额"]`)
  await frame.waitForFunction(
    () => {
      const balance = document.querySelector('.balance')
      return balance !== null && balance.getAttribute('data-state') !== 'loading'
    },
    undefined,
    { timeout: 20000 },
  ).catch(() => false)
  const seen = await frame.evaluate(() => ({
    state: document.querySelector('.balance')?.getAttribute('data-state') ?? '',
    text: (document.body.innerText ?? '').trim(),
  }))
  check('DSH 余额卡经能力桥拿到结果或失败', seen.state === 'ready' || seen.state === 'failed', JSON.stringify(seen))
  check('DSH 余额卡写出了余额或原因', seen.text.length > 0, seen.text.slice(0, 60))
}

module.exports = { capabilityPass }
