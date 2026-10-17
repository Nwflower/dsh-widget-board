import { PACKAGE_NAME } from '@dsh-widget-board/contracts'
import badge from './badge.css'
import board from './board.css'
import dock from './dock.css'
import library from './library.css'
import settings from './settings.css'
import tabs from './tabs.css'

/** 看板外壳、标签条、设置节、下方浮层、组件库浮窗与入口徽标各一份样式，挂进文档头时拼成一张。 */
const sheet = `${board}\n${tabs}\n${settings}\n${dock}\n${library}\n${badge}`

/**
 * 把本插件的样式表挂进文档头。
 *
 * 加载器按 `data-plugin` 与 `data-plugin-css` 认领插件自己的 `<style>`，卸载插件时一并移除。
 *
 * @returns 移除这个样式元素的函数。
 */
export function mountStyle(): () => void {
  const element = document.createElement('style')
  element.dataset.plugin = PACKAGE_NAME
  element.dataset.pluginCss = 'widget-board'
  element.textContent = sheet
  document.head.append(element)
  return () => element.remove()
}
