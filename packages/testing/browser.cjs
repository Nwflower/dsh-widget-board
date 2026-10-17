/**
 * browser.cjs — 这些检查驱动的那台无头 Chrome/Edge，以及它们共用的查找逻辑。
 *
 * 跑的是机器上已经装着的 Chrome 或 Edge，Playwright 自带的浏览器从不下载；CHROME_PATH 覆盖
 * 查找结果。
 */
'use strict'
const fs = require('node:fs')
const { chromium } = require('playwright')

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

/**
 * 要驱动的那台浏览器：CHROME_PATH，否则第一个装着的 Chrome 或 Edge。
 *
 * @returns 可执行文件的路径；一个都没有时抛错。
 */
function findBrowser() {
  const found = CANDIDATES.filter(Boolean).find((candidate) => fs.existsSync(candidate))
  if (found === undefined) throw new Error('找不到本机的 Chrome 或 Edge，请设 CHROME_PATH')
  return found
}

/**
 * 起一个无头浏览器。
 *
 * 关掉后台节流：被浏览器判为后台的页面按几分之一的节奏跑动画帧，等一次重画的读数会等不到。
 *
 * @param options.headless - 不开窗口（默认开）。
 * @param options.args - 额外的 Chrome 开关。
 * @returns Playwright 的 Browser。
 */
async function launchBrowser(options = {}) {
  return chromium.launch({
    executablePath: findBrowser(),
    headless: options.headless ?? true,
    args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', ...options.args ?? []],
  })
}

/**
 * 在已经跑着的浏览器上开一个隔离的上下文，它的缓存、cookie 与存储都是自己的。
 *
 * @param browser - `launchBrowser` 起的浏览器。
 * @param options.width/height - 视口。
 * @returns Playwright 的 BrowserContext。
 */
async function newContextOn(browser, options = {}) {
  return browser.newContext({ viewport: { width: options.width ?? 1280, height: options.height ?? 900 } })
}

module.exports = { findBrowser, launchBrowser, newContextOn }
