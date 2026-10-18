/**
 * 会话里的工具视图共用的几样（D9）：它们不在看板根节点下面，宽度、主题与根字号各自去读。
 */
import { useEffect, useState } from 'react'
import type { ShellTheme } from './theme'
import { resolveTheme, watchTheme } from './theme'

/** 根字号：高度按 rem 给出（D16）。 */
export function rootFontSize(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}

/**
 * 跟着自己的盒子变宽变窄。
 *
 * @returns 一个挂到容器上的 ref 与当前宽度（像素）；容器还没挂上时宽度是 0。
 */
export function useWidth(): { ref: (node: HTMLDivElement | null) => void, width: number } {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (node === null) return
    const update = (): void => { setWidth(node.getBoundingClientRect().width) }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [node])
  return { ref: setNode, width }
}

/**
 * 跟随宿主主题（D10）：工具视图与看板用同一份令牌。
 *
 * @param context - 浏览器半边的根上下文；视图拿得到时传它，切皮肤也能收到。
 * @returns 当前主题。
 */
export function useTheme(context?: unknown): ShellTheme {
  const [theme, setTheme] = useState<ShellTheme>(resolveTheme)
  useEffect(() => watchTheme(context, setTheme), [context])
  return theme
}
