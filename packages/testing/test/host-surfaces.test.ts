/**
 * 宿主接入面的契约测试（D1）。
 *
 * 根 manifest 的每一处声明都对着加载器的一个事实：导出路径就是构建写出的文件、浏览器半边声明成
 * web 平台、补丁行的名字就是包名。这些对不上时插件在宿主里静默不出现，页面上不会有任何报错，
 * 所以由测试盯着。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MAIN_SLOT, SIDEBAR_PANELLIST_SLOT, WIDGET_BOARD_PANEL_ID } from '@dsh-widget-board/contracts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

describe('根 manifest', () => {
  it('两个半边的导出路径就是构建写出的文件', () => {
    expect(manifest.exports['.']).toBe('./lib/host/index.js')
    expect(manifest.exports['./client']).toBe('./lib/client.js')
    expect(path.resolve(ROOT, manifest.main)).toBe(path.resolve(ROOT, manifest.exports['.']))
  })

  it('浏览器半边声明成 web 平台', () => {
    expect(manifest.dsh.client.platform).toBe('web')
  })

  it('补丁行的名字就是包名', () => {
    const patch = readFileSync(path.join(ROOT, manifest.dsh.bundle.patch), 'utf8')
    expect(patch).toContain(`name: '${manifest.name}'`)
  })

  it('发布的文件里有 lib 与补丁', () => {
    expect(manifest.files).toContain('lib')
    expect(manifest.files).toContain('cordis.patch.yml')
  })
})

describe('插槽契约', () => {
  it('面板 id 同时是侧栏行的 id 与中栏页面的 key', () => {
    expect(WIDGET_BOARD_PANEL_ID).toBe('widget-board')
  })

  it('每个插槽名在 docs/host-surfaces.md 里都有出处', () => {
    const doc = readFileSync(path.join(ROOT, 'docs', 'host-surfaces.md'), 'utf8')
    for (const slot of [SIDEBAR_PANELLIST_SLOT, MAIN_SLOT]) expect(doc).toContain(`'${slot}'`)
  })
})
