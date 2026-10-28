#!/usr/bin/env node
'use strict'
/**
 * road.cjs — 冒烟各场景共用的两件小事：等一个条件成立、等一会儿。
 *
 * 每个场景文件都从界面走同一条路径，等待与休眠的写法只在这里写一次（AGENTS.md 的停止线：同一种
 * 写法出现第二遍就移进共享层）。
 */

/**
 * 等一会儿。
 *
 * @param ms - 毫秒数。
 * @returns 到点之后 resolve。
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 等一个条件成立；超时返回 false，让判据自己记下失败而不把整趟冒烟打断。
 *
 * @param probe - 返回布尔值的异步函数。
 * @param timeout - 最长等多久。
 * @returns 成立时为 true。
 */
async function waitFor(probe, timeout = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await probe()) return true
    await sleep(150)
  }
  return false
}

module.exports = { sleep, waitFor }
