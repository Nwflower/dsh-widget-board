'use strict'
/** 真实沙箱里的跨任务排版契约；只比较确定性的字体、字号和间距。 */
const tokens = require('../contracts/tokens.json')

async function visualContractPass(page, check) {
  const expectedFont = await page.locator('[data-dsh-widget-board-view]').evaluate((element) => getComputedStyle(element).fontFamily)
  const handles = await page.locator('.dsh-widget-board__flow[data-active="true"] iframe.dsh-widget-board__frame').elementHandles()
  check('视觉契约检查真实卡片', handles.length > 0, String(handles.length))
  for (const handle of handles) {
    const frame = await handle.contentFrame()
    if (!frame) continue
    const title = await handle.getAttribute('title')
    const ready = await frame.waitForFunction((expected) => getComputedStyle(document.body).fontFamily === expected, expectedFont, { timeout: 5000 }).then(() => true, () => false)
    check(`统一宿主字体 ${title}`, ready)
    const result = await frame.evaluate(() => {
      const body = getComputedStyle(document.body)
      const card = document.querySelector('.t-data, .todo')
      const heading = document.querySelector('.t-data__title, .todo-title')
      const ordinary = document.querySelector('.md-card__body, .todo-text, .links-card__title')
      return {
        width: innerWidth, height: innerHeight,
        bodySize: body.fontSize, bodyLine: body.lineHeight,
        padding: card ? getComputedStyle(card).paddingTop : null,
        titleSize: heading ? getComputedStyle(heading).fontSize : null,
        ordinarySize: ordinary ? getComputedStyle(ordinary).fontSize : null,
        clippedNotes: [...document.querySelectorAll('.links-card__note')].filter((element) => element.getClientRects().length > 0 && element.textContent.length <= 4 && element.clientWidth + 1 < element.scrollWidth).length,
      }
    })
    check(`统一正文字号与行高 ${title}`, result.bodySize === tokens.type.body && Math.abs(parseFloat(result.bodyLine) - parseFloat(tokens.type.body) * 1.5) < 0.1, JSON.stringify(result))
    const compact = result.width <= 320 || result.height <= 320
    if (result.padding !== null) check(`统一卡片内边距 ${title}`, result.padding === (compact ? tokens.space.md : tokens.space.xl), JSON.stringify(result))
    if (result.titleSize !== null) check(`统一标题层级 ${title}`, result.titleSize === (compact ? tokens.type.body : tokens.type.title), JSON.stringify(result))
    if (result.ordinarySize !== null) check(`正文不随盒子放大 ${title}`, result.ordinarySize === tokens.type.body, JSON.stringify(result))
    check(`短备注完整可读 ${title}`, result.clippedNotes === 0, JSON.stringify(result))
  }
}

module.exports = { visualContractPass }
