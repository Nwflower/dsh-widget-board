/**
 * 会话里的 `widget_define` 视图（D9、D13）：调用进行中时替宿主做自检，结果出来之后把组件画出来。
 *
 * 宿主自己画不出组件。这次调用挂在会话页面上时，这个视图按调用 id 去宿主取自检任务，把新版本放进
 * 几个代表性的盒子，隔着端口让组件运行时里的检查器量一遍，再把报告交回去；宿主把结论写进工具结果。
 * 结论随结果留在会话日志里，会话重新打开时按 `meta` 重画，不再重跑自检。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { DefineValue, InspectionReport, SelfCheckBoxResult } from '@dsh-widget-board/contracts'
import type { ToolViewProps } from '@dsh-widget-board/contracts'
import {
  SELF_CHECK_COLUMN_REM,
  SELF_CHECK_GAP_REM,
  SELF_CHECK_TIMEOUT_MS,
  selfCheckPath,
} from '@dsh-widget-board/contracts'
import { t } from './copy'
import { frameHostOf } from './page-frames'
import { SnapshotSurface } from './snapshot-surface'
import type { SnapshotSurfaceHandle } from './snapshot-surface'
import { rootFontSize, useTheme, useWidth } from './view-hooks'

/** 取任务的最长等待：与宿主那边的时限相同，晚一点也交不回去了。 */
const JOB_DEADLINE_MS = SELF_CHECK_TIMEOUT_MS - 2000

/** 两份任务之间隔多久再问一次；工具视图比宿主登记任务更早挂上。 */
const POLL_MS = 300

/** 一个盒子量之前等它静置多久：动画与异步绘制落定（D13 的「静置」）。 */
const SETTLE_MS = 700

/** 等一份检查报告的上限：过了就当这个盒子没有应答。 */
const INSPECT_TIMEOUT_MS = 2000

/** 一次自检任务：宿主给的那一份。 */
interface Job {
  widget: string
  hash: string
  props: Record<string, unknown>
  data: unknown
  text: Record<string, { zh: string, en: string }>
  boxes: { cols: number, h: number }[]
}

/** 画廊里一个盒子的测量。 */
interface Measured {
  box: { cols: number, h: number }
  report: InspectionReport | null
  problems: string[]
}

/**
 * 把一个盒子按列数换算成像素宽。
 *
 * @param cols - 跨列数。
 * @returns 像素宽；与看板一列的宽度一致（D16）。
 */
function widthOf(cols: number): number {
  return Math.round(cols * SELF_CHECK_COLUMN_REM * rootFontSize() + (cols - 1) * SELF_CHECK_GAP_REM * rootFontSize())
}

/**
 * 把一次 `widget_define` 画出来：进行中做自检，结果出来后显示结论与预览。
 *
 * @param props - 工具视图的阶段、调用 id 与结果块，以及插件根上下文。
 * @returns 画面。
 */
export function DefineView({ phase, callId, block, context }: ToolViewProps & { context?: unknown }): ReactNode {
  const value = phase === 'result' ? defineOf(block.meta) : undefined
  const failed = phase === 'result' && block.isError
  const { ref, width } = useWidth()
  const theme = useTheme(context)
  const gallery = useSelfCheck(phase === 'start' ? callId : null, theme)
  if (failed) {
    const text = block.content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n')
    return <p className="dsh-widget-board-tool__note">{text || t('defineName')}</p>
  }
  if (value === undefined) {
    return (
      <>
        <p className="dsh-widget-board-tool__note" role="status">{gallery.line}</p>
        {gallery.node}
      </>
    )
  }
  return (
    <div ref={ref} className="dsh-widget-board-tool" data-dsh-widget-board-tool="define">
      <p className="dsh-widget-board-tool__head">
        <strong>{value.title.zh}</strong>
        <code>{value.id}</code>
        <span>{checkLabel(value)}</span>
      </p>
      {value.check.problems.length === 0 ? null : (
        <ul className="dsh-widget-board-tool__problems">
          {value.check.problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      )}
      {width === 0 ? null : (
        <SnapshotSurface
          hash={value.hash}
          title={value.title.zh}
          props={value.preview.props}
          data={value.preview.data}
          state={null}
          text={{}}
          size={{ w: width, h: Math.round(value.height * rootFontSize()), placement: 'inline', family: 'inline', cols: 1 }}
          placement="inline"
          theme={theme}
          frames={frameHostOf()}
        />
      )}
    </div>
  )
}

/**
 * 自检的结论读成一句话。
 *
 * @param value - 工具的返回。
 * @returns 那句话。
 */
function checkLabel(value: DefineValue): string {
  if (value.check.status === 'passed') return `${t('checkTitle')}：${t('checkPassed')}`
  if (value.check.status === 'failed') return `${t('checkTitle')}：${t('checkFailed')}（${String(value.check.problems.length)}）`
  return `${t('checkTitle')}：${t('checkUnverified')}`
}

/**
 * 结果块里的 DefineValue；形状不对时给 `undefined`。
 *
 * @param meta - 工具结果里的 `meta`。
 * @returns 定义的组件。
 */
function defineOf(meta: unknown): DefineValue | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const value = meta as Partial<DefineValue>
  if (typeof value.id !== 'string' || typeof value.hash !== 'string') return undefined
  if (typeof value.height !== 'number' || typeof value.preview !== 'object' || value.preview === null) return undefined
  if (typeof value.check !== 'object' || value.check === null) return undefined
  return {
    id: value.id,
    dir: value.dir ?? '',
    hash: value.hash,
    replaced: value.replaced === true,
    notes: value.notes ?? [],
    check: value.check,
    preview: value.preview,
    title: value.title ?? { zh: value.id, en: value.id },
    height: value.height,
  }
}

/**
 * 按调用 id 取自检任务、量完、把报告交回宿主。
 *
 * @param callId - 进行中的调用 id；不是进行中时给 `null`。
 * @param theme - 画面用的主题。
 * @returns 一句状态文字与画廊（量完就空了）。
 */
function useSelfCheck(callId: string | null, theme: ReturnType<typeof useTheme>): { line: string, node: ReactNode } {
  const [job, setJob] = useState<Job | null>(null)
  const [state, setState] = useState<'waiting' | 'measuring' | 'done'>('waiting')
  const [results, setResults] = useState<Map<number, Measured>>(() => new Map())
  const settled = useRef(false)
  const frames = frameHostOf()
  useEffect(() => {
    if (callId === null) return
    let live = true
    const started = Date.now()
    const ask = async (): Promise<void> => {
      while (live && Date.now() - started < JOB_DEADLINE_MS) {
        try {
          const response = await fetch(selfCheckPath(callId))
          if (response.status === 410) return
          if (response.ok) {
            const body = await response.json() as { job?: Job }
            if (live && body.job !== undefined) {
              setJob(body.job)
              setState('measuring')
              return
            }
          }
        } catch {
          // 宿主还没起来或这一刻连不上：下一轮再问。
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      }
    }
    void ask()
    return () => { live = false }
  }, [callId])
  const measured = useCallback((index: number, entry: Measured): void => {
    setResults((current) => {
      if (current.has(index)) return current
      const next = new Map(current)
      next.set(index, entry)
      return next
    })
  }, [])
  const total = job?.boxes.length ?? 0
  // 全部盒子都量完就交一次报告；一份任务只交一次。
  useEffect(() => {
    if (job === null || callId === null || settled.current || results.size < job.boxes.length) return
    settled.current = true
    const boxes: SelfCheckBoxResult[] = job.boxes.map((box, index) => {
      const entry = results.get(index)
      if (entry === undefined || entry.report === null) return { box, failure: '组件没有应答', problems: [] }
      return { box, report: entry.report, problems: entry.problems }
    })
    void fetch(selfCheckPath(callId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boxes }),
    }).catch(() => undefined).finally(() => { setState('done') })
  }, [job, callId, results])
  const line = job === null
    ? t('checkWaiting')
    : state === 'done' ? t('checkFinished') : `${t('checkRunning')} ${String(results.size)}/${String(total)}`
  const node = job === null || state === 'done' ? null : (
    <div className="dsh-widget-board-tool__gallery" aria-hidden="true">
      {job.boxes.map((box, index) => (
        <GalleryBox
          key={`${String(index)}-${String(box.cols)}x${String(box.h)}`}
          job={job}
          index={index}
          box={box}
          theme={theme}
          onMeasured={measured}
        />
      ))}
    </div>
  )
  return { line, node }
}

/**
 * 画廊里的一个盒子：画在屏幕之外、等静置、量一次，把结果交给调用方。
 *
 * @param props - 任务、盒子的序号与尺寸、主题与回调。
 * @returns 画在屏幕之外的快照。
 */
function GalleryBox({ job, index, box, theme, onMeasured }: {
  job: Job
  index: number
  box: { cols: number, h: number }
  theme: ReturnType<typeof useTheme>
  onMeasured: (index: number, entry: Measured) => void
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const done = useRef(false)
  const surface = useRef<SnapshotSurfaceHandle | null>(null)
  const settle = useCallback((): void => {
    if (done.current) return
    done.current = true
    // 检查经端口送进组件运行时（D13）：沙箱帧与父页面跨源，读不到它窗口上的属性；判定与尺寸
    // 矩阵用同一份检查器，只是从桥上过去。
    const asked = surface.current?.inspect(INSPECT_TIMEOUT_MS) ?? Promise.resolve(null)
    void asked.then((result) => {
      onMeasured(index, {
        box,
        report: result?.report ?? null,
        problems: result === null ? [] : [...result.problems],
      })
    })
  }, [box, index, onMeasured])
  useEffect(() => {
    if (height === null && failure === null) return
    const timer = window.setTimeout(settle, SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [height, failure, settle])
  const rem = rootFontSize()
  return (
    <div ref={ref}>
      <SnapshotSurface
        ref={surface}
        hash={job.hash}
        title={job.widget}
        props={job.props}
        data={job.data}
        state={null}
        text={job.text}
        size={{ w: widthOf(box.cols), h: Math.round(box.h * rem), placement: 'board', family: 'board', cols: box.cols }}
        placement="board"
        theme={theme}
        frames={frameHostOf()}
        onHeight={setHeight}
        onFailure={setFailure}
        inert
      />
    </div>
  )
}
