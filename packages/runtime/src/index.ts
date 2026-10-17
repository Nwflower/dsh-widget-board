/**
 * 组件运行时（D3、D7）：在组件的 iframe 里装好 `window.widget`。
 *
 * 三种输入都只从这里进来：宿主经端口推来的尺寸、props、data、state，系统给的动效偏好，以及组件
 * 自己的交互。消息按 `contracts` 里的形状判定，认不出的类型与超长的载荷丢弃并报告。
 */
import type {
  MotionLevel,
  ParentMessage,
  WidgetMessage,
  WidgetSize,
} from '@dsh-widget-board/contracts'
import { PARENT_MESSAGE_TYPES, withinLimit } from '@dsh-widget-board/contracts'

/** 组件的公共接口，写在编写指南里的那一份。 */
export interface WidgetApi {
  /** 当前的像素盒与尺寸族；握手之前是 null。 */
  readonly size: WidgetSize | null
  /** 宿主的界面语言，如 `zh-CN`。 */
  readonly lang: string
  readonly props: Record<string, unknown>
  readonly data: unknown
  readonly state: unknown
  onSize(handler: (size: WidgetSize) => void): () => void
  onProps(handler: (props: Record<string, unknown>) => void): () => void
  onData(handler: (data: unknown) => void): () => void
  onState(handler: (state: unknown) => void): () => void
  /** 把一份局部状态交给宿主保存（D5）。 */
  setState(patch: unknown): void
  /** 发出 manifest 里声明过的动作（D6）。 */
  action(id: string, payload?: unknown): void
  /** 内联在会话正文里时上报自身高度。 */
  fit(): void
  /** manifest `text` 里的一条文案，按当前语言取。 */
  t(key: string): string
  reportError(message: string): void
}

declare global {
  interface Window {
    widget?: WidgetApi
  }
}

/** 握手消息：父页面验证来源之后才把端口递进来。 */
const CONNECT = 'connect'

/** 一帧的根节点，运行时往它上面写尺寸族、动画档位与列行数。 */
const root = document.documentElement

let port: MessagePort | null = null
let size: WidgetSize | null = null
let lang = root.lang || 'zh-CN'
let props: Record<string, unknown> = {}
let data: unknown = undefined
let state: unknown = undefined
let text: Record<string, { zh: string, en: string }> = {}

type Listeners = {
  size: Array<(size: WidgetSize) => void>
  props: Array<(props: Record<string, unknown>) => void>
  data: Array<(data: unknown) => void>
  state: Array<(state: unknown) => void>
}

const listeners: Listeners = { size: [], props: [], data: [], state: [] }

/** 发一条消息给父页面；没有端口时什么也不做（组件单独打开时）。 */
function send(message: WidgetMessage): void {
  if (port === null) return
  port.postMessage(message)
}

/**
 * 把尺寸写到根节点：尺寸族给 CSS 选排版，列行数给需要按格计算的组件（D4）。
 *
 * @param next - 新的像素盒与尺寸族。
 */
function applySize(next: WidgetSize): void {
  size = next
  root.dataset.size = next.family
  root.style.setProperty('--w-cols', String(next.cols))
  root.style.setProperty('--w-rows', String(next.rows))
  for (const handler of listeners.size) handler(next)
}

/** 把宿主送来的令牌写成 iframe 根节点的 `--w-*`（D10）。 */
function applyTokens(tokens: Record<string, string> | undefined): void {
  if (tokens === undefined) return
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(`--w-${name}`, value)
}

/**
 * 量一次内容高度交给父页面：信息流看板按它决定卡片多高（D15）。
 *
 * 量的是文档正文的内容盒——组件按自己的宽度定高，视口的高低不影响这个数。
 */
function reportHeight(): void {
  const height = Math.ceil(document.body.getBoundingClientRect().height)
  if (height > 0) send({ type: 'height', height })
}

/** 布局落定之后再量，免得量到一半的排版。 */
function reportHeightSoon(): void {
  requestAnimationFrame(reportHeight)
}

/**
 * 系统是否要求减弱动效；组件自己的媒体查询是这一帧里最准的答案。
 *
 * @param fromHost - 宿主送来的档位。
 * @returns 要用的档位。
 */
function motionLevel(fromHost: MotionLevel): MotionLevel {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return reduced ? 'reduced' : fromHost
}

/** 一条父页面消息落到状态上并通知订阅者。 */
function receive(message: ParentMessage): void {
  switch (message.type) {
    case 'init':
      lang = message.lang
      root.lang = message.lang
      text = message.text ?? {}
      root.dataset.motion = motionLevel(message.motion)
      applyTokens(message.tokens)
      props = (message.props ?? {}) as Record<string, unknown>
      data = message.data
      state = message.state
      applySize(message.size)
      for (const handler of listeners.props) handler(props)
      for (const handler of listeners.data) handler(data)
      for (const handler of listeners.state) handler(state)
      reportHeightSoon()
      return
    case 'size':
      applySize(message.size)
      reportHeightSoon()
      return
    case 'props':
      props = (message.props ?? {}) as Record<string, unknown>
      for (const handler of listeners.props) handler(props)
      return
    case 'data':
      data = message.data
      for (const handler of listeners.data) handler(data)
      return
    case 'state':
      state = message.state
      for (const handler of listeners.state) handler(state)
      return
    case 'pause':
      root.toggleAttribute('data-paused', true)
      return
    case 'resume':
      root.removeAttribute('data-paused')
      return
  }
}

/** 订阅一个列表，返回退订函数。 */
function subscribe<T>(list: Array<(value: T) => void>, handler: (value: T) => void): () => void {
  list.push(handler)
  return () => {
    const at = list.indexOf(handler)
    if (at >= 0) list.splice(at, 1)
  }
}

/** 装好 `window.widget`。 */
function install(): void {
  const api: WidgetApi = {
    get size() { return size },
    get lang() { return lang },
    get props() { return props },
    get data() { return data },
    get state() { return state },
    onSize: (handler) => subscribe(listeners.size, handler),
    onProps: (handler) => subscribe(listeners.props, handler),
    onData: (handler) => subscribe(listeners.data, handler),
    onState: (handler) => subscribe(listeners.state, handler),
    setState: (patch) => send({ type: 'setState', patch }),
    action: (id, payload) => send({ type: 'action', id, payload }),
    fit: () => send({ type: 'height', height: root.scrollHeight }),
    t: (key) => {
      const entry = text[key]
      if (entry === undefined) return key
      return lang.startsWith('zh') ? entry.zh : entry.en
    },
    reportError: (message) => send({ type: 'error', message }),
  }
  window.widget = api
}

/** 认下父页面递来的端口，之后只按端口说话（D3）。 */
function adoptPort(next: MessagePort): void {
  if (port !== null) return
  port = next
  port.onmessage = (event: MessageEvent) => {
    const message = event.data as ParentMessage | undefined
    if (message === undefined || typeof message.type !== 'string') return
    if (!(PARENT_MESSAGE_TYPES as readonly string[]).includes(message.type)) return
    if (!withinLimit(message)) {
      port?.postMessage({ type: 'error', message: `消息超过 ${withinLimit} 的长度上限` })
      return
    }
    receive(message)
  }
  port.start()
}

/**
 * 触屏按下：一次点击至少按满一个 press 时长，回落可见。
 *
 * 只在指针不是鼠标时接管；时长读套件令牌，读不到时用 150 毫秒。
 */
function installPress(): void {
  const selector = 'button, [role="button"], [role="tab"], summary, .t-pressable'
  const raw = getComputedStyle(root).getPropertyValue('--w-motion-press')
  const minimum = Number.parseFloat(raw) || 150
  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return
    const target = event.target
    if (!(target instanceof Element)) return
    const control = target.closest<HTMLElement>(selector)
    if (control === null || control.dataset.pressed === 'on') return
    const started = performance.now()
    control.dataset.pressed = 'on'
    const release = (): void => {
      document.removeEventListener('pointerup', release, true)
      document.removeEventListener('pointercancel', release, true)
      window.setTimeout(() => { delete control.dataset.pressed }, Math.max(0, minimum - (performance.now() - started)))
    }
    document.addEventListener('pointerup', release, true)
    document.addEventListener('pointercancel', release, true)
  }, { passive: true })
}

install()
installPress()
// 内容高度一变就报一次：信息流看板的卡片高度只由组件的内容决定（D15）。
new ResizeObserver(reportHeight).observe(document.body)

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as { type?: unknown, ports?: MessagePort[] } | undefined
  if (message === undefined || message.type !== CONNECT) return
  // 只有这一帧的父页面能把端口递进来；别的窗口递来的连接一概不认（D3）。
  if (event.source !== window.parent) return
  const [next] = event.ports
  if (next === undefined) return
  adoptPort(next)
})

if (window.parent !== window) {
  window.parent.postMessage({ type: 'ready' }, '*')
} else {
  // 单独打开这份文档时没有宿主：按视口给一个尺寸，便于本地核对外观。
  applySize({ w: window.innerWidth, h: window.innerHeight, family: 'inline', cols: 1, rows: 0 })
  root.dataset.motion = motionLevel('full')
}
