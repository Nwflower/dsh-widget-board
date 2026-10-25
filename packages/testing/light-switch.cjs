#!/usr/bin/env node
'use strict'
/**
 * light-switch.cjs — 开关灯的真实宿主检查（D24、D29）。
 *
 * 组件的开关经 `dsh.theme` 能力改外观：浏览器半边接住调用，把主题切换包进一次整页的圆点转场。这里
 * 核对三件事：卡片按当前配色画出对应的一面、点击后整页与卡片一起切、转场期间根节点上的标记挂上又
 * 收起。跑完把主题切回原样，后面的检查不受影响。
 */
const { centerCard, frameOf } = require('./frames.cjs')

/** 转场标记在根节点上的属性名；只在一次转场期间存在。 */
const VT = 'data-dsh-widget-board-vt'

/**
 * 在一张真实的开关灯卡片上按一次开关。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param check - 记一条判据的函数。
 */
async function lightSwitchPass(page, check) {
  const frame = await frameOf(page, 'iframe.dsh-widget-board__frame[title="开关灯"]')
  await centerCard(page, '开关灯')
  const before = await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))
  const drawn = await frame.evaluate(() => document.querySelector('.lamp')?.dataset.mode ?? '')
  check('开关灯按当前配色画出日间或夜间', drawn === (before ? 'dark' : 'light'), JSON.stringify({ dark: before, drawn }))

  const bulb = await frame.evaluate(() => {
    const card = document.querySelector('.lamp').getBoundingClientRect()
    const bulb = document.querySelector('.lamp__bulb').getBoundingClientRect()
    return { x: bulb.left - card.left + bulb.width / 2, y: bulb.top - card.top + bulb.height / 2 }
  })

  await page.evaluate((attribute) => {
    window.__lightSwitchVt = []
    window.__lightSwitchOrigin = null
    new MutationObserver(() => {
      const seen = window.__lightSwitchVt
      const root = document.documentElement
      const on = root.hasAttribute(attribute)
      if (on && seen[seen.length - 1] !== 'on') {
        seen.push('on')
        const box = document.querySelector('iframe.dsh-widget-board__frame[title="开关灯"]').getBoundingClientRect()
        const xRaw = root.style.getPropertyValue('--dsh-widget-board-vt-x')
        const yRaw = root.style.getPropertyValue('--dsh-widget-board-vt-y')
        window.__lightSwitchOrigin = {
          x: Number.parseFloat(xRaw),
          y: Number.parseFloat(yRaw),
          xRaw,
          yRaw,
          vw: innerWidth,
          vh: innerHeight,
          box: { x: box.x, y: box.y },
        }
      }
      if (!on && seen[seen.length - 1] === 'on') seen.push('off')
    }).observe(document.documentElement, { attributes: true, attributeFilter: [attribute] })
  }, VT)

  await frame.locator('.lamp__bulb').click()
  await page.waitForFunction((dark) => document.body.hasAttribute('data-ds-dark-theme') !== dark, before, { timeout: 10000 })
  await page.waitForFunction((attribute) => !document.documentElement.hasAttribute(attribute), VT, { timeout: 10000 })
  const after = await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))
  const redrawn = await frame.evaluate(() => document.querySelector('.lamp')?.dataset.mode ?? '')
  check('按下开关后整页配色真的切换', after !== before, JSON.stringify({ before, after }))
  check('卡片跟着换成另一面', redrawn === (after ? 'dark' : 'light'), JSON.stringify({ after, redrawn }))
  const seen = await page.evaluate(() => window.__lightSwitchVt)
  check('整页圆点转场挂上又收起', seen.includes('on') && seen[seen.length - 1] === 'off', JSON.stringify(seen))

  const ring = await frame.evaluate(() => {
    const card = document.querySelector('.lamp')
    return {
      x: Number.parseFloat(card.style.getPropertyValue('--lamp-ring-x')),
      y: Number.parseFloat(card.style.getPropertyValue('--lamp-ring-y')),
    }
  })
  const origin = await page.evaluate(() => window.__lightSwitchOrigin)
  // 整页圆心用百分比写，换像素密度不会缩到左上角；这里把卡片里的按下点也换成同一个百分数再比。
  const expectedX = origin === null ? 0 : ((origin.box.x + ring.x) / origin.vw) * 100
  const expectedY = origin === null ? 0 : ((origin.box.y + ring.y) / origin.vh) * 100
  const aligned = origin !== null
    && Math.abs(ring.x - bulb.x) <= 2
    && Math.abs(ring.y - bulb.y) <= 2
    && origin.xRaw.endsWith('%') && origin.yRaw.endsWith('%')
    && Math.abs(origin.x - expectedX) <= 0.3
    && Math.abs(origin.y - expectedY) <= 0.3
  check('卡片波纹与整页圆点用同一个圆心', aligned, JSON.stringify({ bulb, ring, origin, expectedX, expectedY }))

  await frame.locator('.lamp__bulb').click()
  await page.waitForFunction((dark) => document.body.hasAttribute('data-ds-dark-theme') === dark, before, { timeout: 10000 })
  check('再按一次回到原来的配色', (await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))) === before)
}

module.exports = { lightSwitchPass }
