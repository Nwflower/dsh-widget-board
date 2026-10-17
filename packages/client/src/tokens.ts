/**
 * 令牌：把 `contracts/tokens.json` 读成一组可以在 iframe 里落地的值（D10）。
 *
 * 组件跑在不透明来源的 iframe 里，宿主的 `--dsw-*` 变量传不过去；宿主页面把它们的计算值经
 * 握手的 `init` 消息递进去，运行时再写成 iframe 根节点上的 `--w-*`。解析不出来的值不发，组件
 * 样式表里的回退值接手。
 */
import tokens from '@dsh-widget-board/contracts/tokens.json'

/** tokens.json 的形状：组名到令牌名的两级表。 */
type TokenTable = Record<string, Record<string, string>>

/** 一个 `var(--name)` 引用里的变量名。 */
const REFERENCE = /^var\((--[a-z0-9-]+)/

/**
 * 解析全部令牌。
 *
 * @returns 以 `组-名` 为键的字面值，解析不出的项不在其中。
 */
export function resolveTokens(): Record<string, string> {
  const style = getComputedStyle(document.body)
  const resolved: Record<string, string> = {}
  for (const [group, entries] of Object.entries(tokens as TokenTable)) {
    for (const [name, value] of Object.entries(entries)) {
      const reference = REFERENCE.exec(value)
      if (reference === null) {
        resolved[`${group}-${name}`] = value
        continue
      }
      const computed = style.getPropertyValue(reference[1]).trim()
      if (computed !== '') resolved[`${group}-${name}`] = computed
    }
  }
  return resolved
}
