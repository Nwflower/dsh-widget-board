/**
 * 桥消息的判定（D3）：缺字段、错类型与不认识的类型都当作没有发过。
 *
 * 两端用的是同一份判定，所以它自己要先站稳：一条形状不对的消息不该走到组件的状态里。
 */
import { describe, expect, it } from 'vitest'
import type { ParentMessage, WidgetMessage, WidgetSize } from '../src/index'
import { isParentMessage, isWidgetMessage, isWidgetSize, withinLimit } from '../src/index'
import { OPEN_URL_LIMIT } from '../src/bridge'

/** 一份完整的尺寸。 */
const SIZE: WidgetSize = { w: 320, h: 220, placement: 'board', family: 'board', cols: 1 }

describe('尺寸', () => {
  it('四个字段齐了才是尺寸', () => {
    expect(isWidgetSize(SIZE)).toBe(true)
    expect(isWidgetSize({ ...SIZE, w: 'wide' })).toBe(false)
    expect(isWidgetSize({ ...SIZE, placement: 'nowhere' })).toBe(false)
    expect(isWidgetSize({ ...SIZE, cols: 0 })).toBe(false)
  })
})

describe('父页面的消息', () => {
  it('init 要带尺寸、令牌、语言、动画档位与文案', () => {
    const init: ParentMessage = {
      type: 'init',
      size: SIZE,
      props: {},
      data: null,
      state: null,
      text: {},
      tokens: { 'color-bg': '#fff' },
      lang: 'zh-CN',
      motion: 'full',
    }
    expect(isParentMessage(init)).toBe(true)
    expect(isParentMessage({ ...init, tokens: undefined })).toBe(false)
    expect(isParentMessage({ ...init, motion: '半个' })).toBe(false)
  })

  it('theme 要带令牌、语言与动画档位', () => {
    expect(isParentMessage({ type: 'theme', tokens: {}, lang: 'en', motion: 'reduced' })).toBe(true)
    expect(isParentMessage({ type: 'theme', lang: 'en', motion: 'reduced' })).toBe(false)
  })

  it('props 必须是对象，data 与 state 只要带着这个字段', () => {
    expect(isParentMessage({ type: 'props', props: { a: 1 } })).toBe(true)
    expect(isParentMessage({ type: 'props', props: 'x' })).toBe(false)
    expect(isParentMessage({ type: 'data', data: null })).toBe(true)
    expect(isParentMessage({ type: 'state', state: undefined })).toBe(true)
    expect(isParentMessage({ type: 'state' })).toBe(false)
  })

  it('pause、resume 没有别的字段', () => {
    expect(isParentMessage({ type: 'pause' })).toBe(true)
    expect(isParentMessage({ type: 'resume' })).toBe(true)
  })

  it('能力调用的回应要带对应的 requestId', () => {
    expect(isParentMessage({ type: 'call-result', requestId: 'c1', result: { ok: true } })).toBe(true)
    expect(isParentMessage({ type: 'call-result', requestId: '', result: null })).toBe(false)
    expect(isParentMessage({ type: 'call-result', requestId: 'c1' })).toBe(false)
    expect(isParentMessage({ type: 'call-error', requestId: 'c1', code: 'failed', message: '坏了' })).toBe(true)
    expect(isParentMessage({ type: 'call-error', requestId: 'c1', code: 'failed' })).toBe(false)
  })

  it('不认识的消息一律不认', () => {
    expect(isParentMessage({ type: 'tokens' })).toBe(false)
    expect(isParentMessage(null)).toBe(false)
    expect(isParentMessage('init')).toBe(false)
  })
})

describe('组件的消息', () => {
  it('认下组件会发的七种消息', () => {
    const messages: WidgetMessage[] = [
      { type: 'ready' },
      { type: 'setState', patch: { a: 1 } },
      { type: 'action', id: 'refresh', payload: null },
      { type: 'height', height: 120 },
      { type: 'error', message: '坏了' },
      { type: 'notify', title: '番茄钟', body: '这一段结束了' },
      { type: 'open', url: 'https://github.com/o/r/issues/1' },
    ]
    for (const message of messages) expect(isWidgetMessage(message)).toBe(true)
  })

  it('跳转只收 http 与 https 的完整地址', () => {
    expect(isWidgetMessage({ type: 'open', url: 'https://github.com/o/r/issues/1' })).toBe(true)
    expect(isWidgetMessage({ type: 'open', url: 'http://127.0.0.1:8080/x' })).toBe(true)
    // 宿主页面的 window.open 跑在会话的来源里：脚本地址、相对路径、空串全不开。
    expect(isWidgetMessage({ type: 'open', url: 'javascript:alert(1)' })).toBe(false)
    expect(isWidgetMessage({ type: 'open', url: 'data:text/html,<script>x</script>' })).toBe(false)
    expect(isWidgetMessage({ type: 'open', url: '/issues/1' })).toBe(false)
    expect(isWidgetMessage({ type: 'open', url: '' })).toBe(false)
    expect(isWidgetMessage({ type: 'open', url: `https://github.com/${'a'.repeat(OPEN_URL_LIMIT)}` })).toBe(false)
    expect(isWidgetMessage({ type: 'open' })).toBe(false)
  })

  it('动作要有名字，高度要是非负数，错误要有原因', () => {
    expect(isWidgetMessage({ type: 'action', id: '' })).toBe(false)
    expect(isWidgetMessage({ type: 'height', height: -1 })).toBe(false)
    expect(isWidgetMessage({ type: 'error', message: 42 })).toBe(false)
  })

  it('能力调用要有 requestId 与能力名，取消只认 requestId', () => {
    expect(isWidgetMessage({ type: 'call', requestId: 'c1', capability: 'dsh.account.balance', args: {} })).toBe(true)
    expect(isWidgetMessage({ type: 'call', requestId: '', capability: 'x' })).toBe(false)
    expect(isWidgetMessage({ type: 'call', requestId: 'c1', capability: '' })).toBe(false)
    expect(isWidgetMessage({ type: 'cancel', requestId: 'c1' })).toBe(true)
    expect(isWidgetMessage({ type: 'cancel', requestId: '' })).toBe(false)
  })

  it('通知只带两段有长度上限的文字', () => {
    expect(isWidgetMessage({ type: 'notify' })).toBe(true)
    expect(isWidgetMessage({ type: 'notify', title: '标题' })).toBe(true)
    expect(isWidgetMessage({ type: 'notify', title: 42 })).toBe(false)
    expect(isWidgetMessage({ type: 'notify', body: 42 })).toBe(false)
    expect(isWidgetMessage({ type: 'notify', title: 'x'.repeat(121) })).toBe(false)
    expect(isWidgetMessage({ type: 'notify', body: 'x'.repeat(401) })).toBe(false)
  })

  it('超长的消息不算数', () => {
    expect(withinLimit({ type: 'error', message: 'x'.repeat(64 * 1024) })).toBe(false)
    expect(withinLimit({ type: 'error', message: 'ok' })).toBe(true)
  })
})
