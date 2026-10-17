/**
 * lifeline.cjs — 让临时宿主跟着调用它的进程一起结束。
 *
 * 宿主的 stdin 由调用方持有，调用方一退出这根管子就关闭；宿主读到关闭就把自己关掉。不这么做
 * 的话，一次中断掉的运行会在机器上留下一个还在跑的 `dsh web`。只有 DSH_WEB_LIFELINE=1 时
 * 生效，`--require` 预加载它才安全。
 */
'use strict'

if (process.env.DSH_WEB_LIFELINE === '1') {
  const end = () => process.exit(0)
  process.stdin.on('end', end)
  process.stdin.on('close', end)
  process.stdin.on('error', end)
}
