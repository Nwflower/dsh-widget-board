/**
 * 替组件打开一个网页（D26）。
 *
 * 组件文档的来源是不透明的，也不带 `allow-popups`，`<a target="_blank">` 点下去什么都不会发生。
 * 点击的「用户激活」跟着桥传到宿主页面，在这里开新标签页才是浏览器认的那一次打开。
 *
 * 地址在 `isWidgetMessage` 里已经按协议筛过；新页用 `noopener`，拿不到本页的 `window.opener`。
 * 带 `noopener` 时 `window.open` 恒返回 null，问不到浏览器是否拦了弹窗。
 *
 * @param url - 要打开的地址。
 */
export function openInNewTab(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}
