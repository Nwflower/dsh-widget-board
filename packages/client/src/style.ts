import { PACKAGE_NAME } from '@dsh-widget-board/contracts'
import visual from './visual.css'
import badge from './badge.css'
import board from './board.css'
import composer from './composer.css'
import management from './board-management/management.css'
import dock from './dock.css'
import editor from './editor.css'
import editorPanels from './editor-panels.css'
import inline from './inline.css'
import library from './library.css'
import settings from './settings.css'
import source from './composer/source.css'
import tabs from './tabs.css'
import tool from './tool.css'

/** 看板、标签管理、编辑器、创建器与源码面板共用宿主样式表。 */
const sheet = `${board}\n${tabs}\n${management}\n${settings}\n${editor}\n${editorPanels}\n${composer}\n${dock}\n${library}\n${inline}\n${tool}\n${badge}\n${source}`

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
  element.textContent = `${sheet}\n${visual}`
  document.head.append(element)
  return () => element.remove()
}
