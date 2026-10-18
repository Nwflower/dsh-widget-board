/**
 * 组件运行时（D3、D7）：在组件的 iframe 里装好 `window.widget`。
 *
 * 三种输入都只从这里进来：宿主经端口推来的尺寸、props、data、state，系统给的动效偏好，以及组件
 * 自己的交互。消息按 `contracts` 里的形状判定，认不出的类型与超长的载荷丢弃并报告。
 */
import type {
  MotionLevel,
  ParentMessage,
  WidgetHandles,
  WidgetMessage,
  WidgetSize,
} from '@dsh-widget-board/contracts'
import { MESSAGE_LIMIT, boxClassesOf, isParentMessage, withinLimit } from '@dsh-widget-board/contracts'
import { installMotionTemplates } from './motion'

/** 组件的公共接口，写在编写指南里的那一份。 */
export interface WidgetApi extends WidgetHandles {
  /** 当前的像素盒与尺寸族；握手之前是 null。 */
  readonly size: WidgetSize | null
  /** 宿主的界面语言，如 `zh-CN`。 */
  readonly lang: string
  readonly props: Record<string, unknown>
  readonly data: unknown
  readonly state: unknown
  /** 宿主是否暂停了这张卡：离开视口（D16、D21）。 */
  readonly paused: boolean
  onSize(handler: (size: WidgetSize) => void): () => void
  onProps(handler: (props: Record<string, unknown>) => void): () => void
  onData(handler: (data: unknown) => void): () => void
  onState(handler: (state: unknown) => void): () => void
  /** 暂停状态变了；组件据此停掉计时器与逐帧绘制（D16）。 */
  onPause(handler: (paused: boolean) => void): () => void
  /** 内联在会话正文里时上报自身高度；看板不使用这个高度。 */
  fit(): void
  reportError(message: string): void
}

declare global {
  interface Window {
    widget?: WidgetApi
  }
}

/** 握手消息：父页面验证来源之后才把端口递进来。 */
const CONNECT = 'connect'

/** 一次能力调用最长等多久；超时后前端不再等，宿主那一侧的 15 秒上限会先中止提供方。 */
const CALL_TIMEOUT_MS = 30_000

/** 一帧的根节点，运行时往它上面写尺寸族、动画档位与列行数。 */
const root = document.documentElement

let port: MessagePort | null = null
let size: WidgetSize | null = null
let lang = root.lang || 'zh-CN'
let props: Record<string, unknown> = {}
let data: unknown = undefined
let state: unknown = undefined
let paused = false
let text: Record<string, { zh: string, en: string }> = {}

/** 在途能力调用的等待者，按 requestId 索引。 */
interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: number
  signal?: AbortSignal
  onAbort?: () => void
}

const pendingCalls = new Map<string, PendingCall>()
let callSequence = 0

type Listeners = {
  size: Array<(size: WidgetSize) => void>
  props: Array<(props: Record<string, unknown>) => void>
  data: Array<(data: unknown) => void>
  state: Array<(state: unknown) => void>
  pause: Array<(paused: boolean) => void>
}

const listeners: Listeners = { size: [], props: [], data: [], state: [], pause: [] }

/** 发一条消息给父页面；没有端口时什么也不做（组件单独打开时）。 */
function send(message: WidgetMessage): void {
  if (port === null) return
  port.postMessage(message)
}

/**
 * 把尺寸写到根节点：尺寸族与位置给 CSS 选排版，跨列数给按格计算的组件（D16）。
 *
 * @param next - 新的像素盒、位置与尺寸族。
 */
function applySize(next: WidgetSize): void {
  size = next
  const box = boxClassesOf(next.w, next.h)
  root.dataset.size = next.family
  root.dataset.placement = next.placement
  root.dataset.boxWidth = box.width
  root.dataset.boxHeight = box.height
  root.style.setProperty('--w-cols', String(next.cols))
  root.style.setProperty('--w-w', `${String(Math.round(next.w))}px`)
  root.style.setProperty('--w-h', `${String(Math.round(next.h))}px`)
  for (const handler of listeners.size) handler(next)
}

/** 把宿主送来的令牌写成 iframe 根节点的 `--w-*`（D10）。 */
function applyTokens(tokens: Record<string, string> | undefined): void {
  if (tokens === undefined) return
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(`--w-${name}`, value)
}

/**
 * 量一次内容高度交给父页面：内联显示时父页面按它决定占多高，看板的卡片高度由布局给出（D16）。
 *
 * 量的是文档正文的内容盒——视口的高低不影响这个数；看板那一侧忽略这条消息。
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
    case 'theme':
      lang = message.lang
      root.lang = message.lang
      root.dataset.motion = motionLevel(message.motion)
      applyTokens(message.tokens)
      return
    case 'pause':
      paused = true
      root.toggleAttribute('data-paused', true)
      for (const handler of listeners.pause) handler(true)
      return
    case 'resume':
      paused = false
      root.removeAttribute('data-paused')
      for (const handler of listeners.pause) handler(false)
      return
    case 'call-result':
    case 'call-error':
      settleCall(message)
      return
  }
}

/** 一条能力调用的回应：把等待者收掉，结果或错误交给调用方。 */
function settleCall(message: Extract<ParentMessage, { type: 'call-result' } | { type: 'call-error' }>): void {
  const pending = pendingCalls.get(message.requestId)
  if (pending === undefined) return
  pendingCalls.delete(message.requestId)
  window.clearTimeout(pending.timer)
  if (pending.signal !== undefined && pending.onAbort !== undefined) {
    pending.signal.removeEventListener('abort', pending.onAbort)
  }
  if (message.type === 'call-result') pending.resolve(message.result)
  else pending.reject(new Error(message.message))
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
    get paused() { return paused },
    onSize: (handler) => subscribe(listeners.size, handler),
    onProps: (handler) => subscribe(listeners.props, handler),
    onData: (handler) => subscribe(listeners.data, handler),
    onState: (handler) => subscribe(listeners.state, handler),
    onPause: (handler) => subscribe(listeners.pause, handler),
    setState: (patch) => send({ type: 'setState', patch }),
    action: (id, payload) => send({ type: 'action', id, payload }),
    call: (capability, args, options) => new Promise((resolve, reject) => {
      if (port === null) {
        reject(new Error('组件还没有连上宿主'))
        return
      }
      const requestId = `call-${String(++callSequence)}`
      const message = { type: 'call' as const, requestId, capability, args }
      if (!withinLimit(message)) {
        reject(new Error('能力调用的参数超过消息长度上限'))
        return
      }
      const timer = window.setTimeout(() => {
        const pending = pendingCalls.get(requestId)
        if (pending === undefined) return
        pendingCalls.delete(requestId)
        reject(new Error(`调用 ${capability} 超时`))
      }, CALL_TIMEOUT_MS)
      const signal = options?.signal
      const onAbort = (): void => {
        if (!pendingCalls.has(requestId)) return
        pendingCalls.delete(requestId)
        window.clearTimeout(timer)
        send({ type: 'cancel', requestId })
        reject(new Error(`调用 ${capability} 已取消`))
      }
      if (signal?.aborted === true) {
        reject(new Error(`调用 ${capability} 已取消`))
        return
      }
      pendingCalls.set(requestId, { resolve, reject, timer, ...(signal === undefined ? {} : { signal, onAbort }) })
      if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })
      send(message)
    }),
    notify: (notification) => send({
      type: 'notify',
      ...(notification?.title === undefined ? {} : { title: notification.title }),
      ...(notification?.body === undefined ? {} : { body: notification.body }),
    }),
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
    const message = event.data as unknown
    if (!isParentMessage(message)) return
    if (!withinLimit(message)) {
      port?.postMessage({ type: 'error', message: `消息超过 ${String(MESSAGE_LIMIT)} 字节的上限` })
      return
    }
    receive(message)
  }
  port.start()
}

/**
 * 组件自己抛出来的异常也要让外壳知道：卡片上显示原因，用户不必去翻开发者工具（D11）。
 *
 * 同一条失败只报一次：未捕获的异常会同时走 `error` 与 `unhandledrejection` 两条路。
 */
let reported: string | null = null
function installFailureReports(): void {
  const report = (message: string): void => {
    if (reported === message) return
    reported = message
    send({ type: 'error', message })
  }
  window.addEventListener('error', (event) => {
    report(event.message || `${event.error instanceof Error ? event.error.message : '脚本出错'}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    report(reason instanceof Error ? reason.message : String(reason))
  })
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
installMotionTemplates()
installFailureReports()
// 内容高度一变就报一次：内联显示按它占位；看板的卡片高度由布局给出（D16）。
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
  applySize({ w: window.innerWidth, h: window.innerHeight, placement: 'inline', family: 'inline', cols: 1 })
  root.dataset.motion = motionLevel('full')
}
