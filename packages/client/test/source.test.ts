/**
 * 源码面板与预览面板的纯逻辑（技术契约 4—5）。
 *
 * 这里不画 React：文件与语言的判定、来源规则给出的目标 id、预览握手里哪些消息要挡住，都是纯
 * 函数，渲染那一层只按这份判定画。
 */
import { describe, expect, it } from 'vitest'
import { languageOf } from '../src/composer/source-editor-loader'
import { suggestedIdOf } from '../src/composer/source-rules'

describe('语言判定', () => {
  it('按后缀给出语言', () => {
    expect(languageOf('widget.json')).toBe('json')
    expect(languageOf('index.html')).toBe('html')
    expect(languageOf('style.css')).toBe('css')
    expect(languageOf('main.js')).toBe('javascript')
    expect(languageOf('notes.txt')).toBe('text')
  })

  it('大小写不影响判定', () => {
    expect(languageOf('MAIN.JS')).toBe('javascript')
    expect(languageOf('Style.CSS')).toBe('css')
  })
})

describe('来源规则', () => {
  it('只读源另存为一个新的用户组件 id', () => {
    expect(suggestedIdOf('clock', 'builtin')).toMatch(/^user-clock-[a-f0-9]{8}$/)
    expect(suggestedIdOf('clock', 'plugin')).toMatch(/^user-clock-[a-f0-9]{8}$/)
  })

  it('用户组件默认另存，每次分配独立 id', () => {
    expect(suggestedIdOf('mine', 'user')).toMatch(/^user-mine-[a-f0-9]{8}$/)
    expect(suggestedIdOf('mine', 'user')).not.toBe(suggestedIdOf('mine', 'user'))
  })

  it('另存用的 id 满足组件 id 的形状', () => {
    for (const source of ['builtin', 'plugin'] as const) {
      const id = suggestedIdOf('a-very-long-widget-name-that-goes-past-the-limit', source)
      expect(id).toMatch(/^[a-z][a-z0-9-]{1,39}$/)
    }
  })

  it('就地改还是另存，看的是来源', () => {
    expect(suggestedIdOf('clock', 'builtin')).not.toBe('clock')
    expect(suggestedIdOf('mine', 'user')).not.toBe('mine')
  })
})
