/**
 * 交换格式（D8）：`.dshw` 与 `.dshboard` 的打包、解包与校验。
 *
 * 这些判据决定「别人的文件进来会发生什么」：路径越界、扩展名不在白名单、文件太多太大、包里没有
 * manifest、看板包的格式版本不对，都要整包拒绝。
 */
import { describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import type { WidgetManifest } from '@dsh-widget-board/contracts'
import { BOARD_PACKAGE_FORMAT, PACKAGE_MAX_FILES, packBoard, packWidget, unpackBoard, unpackWidget } from '../src/package'

/** 一个最小的组件目录。 */
function filesOf(): { path: string, content: Uint8Array }[] {
  return [
    { path: 'widget.json', content: strToU8(JSON.stringify({ id: 'demo', title: { zh: '演示', en: 'Demo' }, version: '0.1.0', sizes: ['s'] })) },
    { path: 'index.html', content: strToU8('<p>hi</p>') },
    { path: 'style.css', content: strToU8('p{}') },
    { path: 'main.js', content: strToU8('void 0') },
    { path: 'assets/logo.svg', content: strToU8('<svg/>') },
  ]
}

describe('.dshw', () => {
  it('打出来再解开，文件与 manifest 都还在', () => {
    const bytes = packWidget(filesOf())
    const back = unpackWidget(bytes)
    expect(back.manifest.id).toBe('demo')
    expect(back.files.map((file) => file.path).sort()).toEqual(['assets/logo.svg', 'index.html', 'main.js', 'style.css', 'widget.json'])
    expect(new TextDecoder().decode(back.files.find((file) => file.path === 'index.html')?.content)).toBe('<p>hi</p>')
  })

  it('路径回到上一层时整包拒绝', () => {
    const files = [...filesOf(), { path: '../escape.js', content: strToU8('x') }]
    expect(() => packWidget(files)).toThrow(/回到上一层/)
  })

  it('绝对路径整包拒绝', () => {
    const files = [...filesOf(), { path: 'C:/windows/x.js', content: strToU8('x') }]
    expect(() => packWidget(files)).toThrow(/绝对路径/)
  })

  it('白名单之外的扩展名整包拒绝', () => {
    const files = [...filesOf(), { path: 'main.exe', content: strToU8('MZ') }]
    expect(() => packWidget(files)).toThrow(/不允许的文件类型/)
  })

  it('文件太多整包拒绝', () => {
    const files = [...filesOf(), ...Array.from({ length: PACKAGE_MAX_FILES }, (_, index) => ({ path: `a${index}.txt`, content: strToU8('x') }))]
    expect(() => packWidget(files)).toThrow(/最多/)
  })

  it('包里没有 widget.json 时拒绝', () => {
    const files = filesOf().filter((file) => file.path !== 'widget.json')
    expect(() => unpackWidget(packWidget(files))).toThrow(/没有 widget.json/)
  })

  it('不是 zip 的字节被拒绝并说明', () => {
    expect(() => unpackWidget(strToU8('这不是压缩包'))).toThrow(/不是有效的组件包/)
  })

  it('manifest 不是合法 JSON 时拒绝', () => {
    const files = [{ path: 'widget.json', content: strToU8('{ 不是 json') }, ...filesOf().slice(1)]
    expect(() => unpackWidget(packWidget(files))).toThrow(/不是合法 JSON/)
  })
})

/** 一个看板包用的组件版本；`id` 省略时是扁平 id 的样例。 */
function widget(id = 'demo'): { hash: string, manifest: WidgetManifest, files: Record<string, string> } {
  const manifest: WidgetManifest = { id, title: { zh: '演示', en: 'Demo' }, version: '0.1.0', sizes: ['s'] }
  return {
    hash: 'a'.repeat(64),
    manifest,
    files: {
      'widget.json': Buffer.from(JSON.stringify(manifest)).toString('base64'),
      'index.html': 'PGgxPkhlbGxvPC9oMT4=',
    },
  }
}

describe('.dshboard', () => {
  it('打出来再解开，卡片与组件版本都还在', () => {
    const bytes = packBoard('我的看板', [{ widget: 'demo', props: { n: 1 }, layout: { x: 0, y: 0, w: 2, h: 14 } }], [widget()])
    const back = unpackBoard(bytes)
    expect(back.format).toBe(BOARD_PACKAGE_FORMAT)
    expect(back.title).toBe('我的看板')
    expect(back.cards).toHaveLength(1)
    expect(back.cards[0]).toMatchObject({ widget: 'demo', props: { n: 1 }, layout: { w: 2, h: 14 } })
    expect(back.widgets[0]?.manifest.id).toBe('demo')
  })

  it('默认不带 data 与 state', () => {
    const bytes = packBoard('b', [{ widget: 'demo', props: {}, layout: { x: 0, y: 0, w: 1, h: 22 } }], [])
    const back = unpackBoard(bytes)
    expect(back.cards[0]).not.toHaveProperty('data')
    expect(back.cards[0]).not.toHaveProperty('state')
  })

  it('格式版本对不上时拒绝', () => {
    const bytes = strToU8(JSON.stringify({ format: 99, title: 'x', cards: [], widgets: [] }))
    expect(() => unpackBoard(bytes)).toThrow(/格式版本/)
  })

  it('卡片缺 layout 的四个数时拒绝', () => {
    const bytes = strToU8(JSON.stringify({ format: BOARD_PACKAGE_FORMAT, title: 'x', cards: [{ widget: 'demo', props: {}, layout: { x: 0, y: 0, w: 1 } }], widgets: [] }))
    expect(() => unpackBoard(bytes)).toThrow(/layout\.h/)
  })

  it('不是 JSON 时拒绝并说明', () => {
    expect(() => unpackBoard(strToU8('不是一个包'))).toThrow(/不是有效的看板包/)
  })
})

/**
 * 作者域 id（D8、D30）：市场来源的组件 id 带作者域，本地组件是扁平 id。看板包按原样带走这两个字符串，
 * 导入时卡片才找得到对应的组件版本。
 */
describe('.dshboard 里的组件 id', () => {
  it('卡片与内嵌的 manifest 都保留原 id：带作者域的不拆开，旧的扁平 id 不改名', () => {
    const bytes = packBoard('看板', [
      { widget: 'nwflower.clock', props: {}, layout: { x: 0, y: 0, w: 1, h: 22 } },
      { widget: 'demo', props: {}, layout: { x: 1, y: 0, w: 1, h: 22 } },
    ], [widget('nwflower.clock'), widget()])
    const back = unpackBoard(bytes)
    expect(back.cards.map((card) => card.widget)).toEqual(['nwflower.clock', 'demo'])
    expect(back.widgets.map((entry) => entry.manifest.id)).toEqual(['nwflower.clock', 'demo'])
    // 内嵌的 widget.json 写的也是同一个字符串：导入之后生效的是它。
    for (const entry of back.widgets) {
      const manifest = JSON.parse(Buffer.from(entry.files['widget.json'] ?? '', 'base64').toString('utf8')) as WidgetManifest
      expect(manifest.id).toBe(entry.manifest.id)
    }
  })
})
