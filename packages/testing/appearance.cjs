'use strict'
const path = require('node:path')
/** 浅深色和三个视口使用相同截图节奏，调用方补上组件专属判据。 */
async function captureAppearance(page, directory, prefix, inspect = async () => {}, widths = [1440, 1024, 640], heightFor = () => 900) {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const width of widths) {
      await page.setViewportSize({ width, height: heightFor(width) })
      await page.waitForTimeout(150)
      await inspect(width, scheme)
      await page.screenshot({ path: path.join(directory, `${prefix}-${width}-${scheme}.png`) })
    }
  }
}
module.exports = { captureAppearance }
