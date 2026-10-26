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
import {
  HOST_SESSION_EVENT,
  HOST_SESSIONS_SERVICE,
  MAIN_SLOT,
  SIDEBAR_PANELLIST_SLOT,
  WIDGET_BOARD_PANEL_ID,
  onSessionEvent,
  sessionsOf,
} from '@dsh-widget-board/contracts'

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

describe('会话服务与事件契约', () => {
  it('服务名与事件名按宿主的原样登记', () => {
    expect(HOST_SESSIONS_SERVICE).toBe('sessions')
    expect(HOST_SESSION_EVENT).toBe('session/event')
  })

  it('服务缺席时读成 undefined，出现时原样交回', () => {
    expect(sessionsOf({})).toBeUndefined()
    expect(sessionsOf({ get: () => undefined })).toBeUndefined()
    const service = { list: () => [{ id: 'one' }] }
    expect(sessionsOf({ get: (name: string) => (name === HOST_SESSIONS_SERVICE ? service : undefined) })).toBe(service)
  })

  it('事件订阅按全局范围建立，退订用宿主给的那一个函数', () => {
    const seen: { event: string, listener: unknown, options: unknown }[] = []
    let stopped = 0
    const off = (): void => { stopped += 1 }
    const context = {
      on(event: string, listener: unknown, options: unknown) {
        seen.push({ event, listener, options })
        return off
      },
    }
    const listener = (): void => {}
    const dispose = onSessionEvent(context, listener)
    expect(seen).toEqual([{ event: 'session/event', listener, options: { global: true } }])
    dispose()
    expect(stopped).toBe(1)
  })

  it('缺少事件接口或退订函数时在发生处抛出', () => {
    expect(() => onSessionEvent({}, () => {})).toThrow(/没有 on/)
    expect(() => onSessionEvent({ on: () => undefined }, () => {})).toThrow(/退订函数/)
  })
})
