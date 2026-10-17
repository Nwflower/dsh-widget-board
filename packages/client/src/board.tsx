import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { BoardSnapshot } from '@dsh-widget-board/contracts'
import { WIDGET_BOARD_PANEL_ID } from '@dsh-widget-board/contracts'
import type { FlowLayout, FlowMetrics } from '@dsh-widget-board/model'
import { PENDING_RATIO, flowLayout, flowMetrics } from '@dsh-widget-board/model'
import type { CardControls } from './card'
import { WidgetCard } from './card'
import { subscribeLive } from './live'
import { fetchSnapshot } from './snapshot'

/** 根字号的像素值：列宽与间距按它换算（D15）。 */
function rootFontSize(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}

/**
 * 中栏的看板页：一列列往下排的信息流（D15）。
 *
 * 列数按这块容器的宽度判定，整页只有一个 ResizeObserver；离开视口的卡片由整页唯一的一个
 * IntersectionObserver 暂停。卡片的高度由组件自己上报，位置由 `model` 的纯函数算出；看板的内容
 * 来自宿主的一次快照，之后随宿主的变更通知重取（D5、D7）。
 */
export function BoardPage(): ReactNode {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<FlowMetrics | null>(null)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [revision, setRevision] = useState(0)
  const flowRef = useRef<HTMLDivElement | null>(null)
  const cards = useRef(new Map<string, { pause: () => void, resume: () => void }>())

  const controls = useMemo<CardControls>(() => ({
    register(id, handlers) {
      cards.current.set(id, handlers)
      return () => { cards.current.delete(id) }
    },
  }), [])

  const onHeight = useCallback((id: string, height: number) => {
    setHeights((current) => (current[id] === height ? current : { ...current, [id]: height }))
  }, [])

  useEffect(() => subscribeLive(setRevision), [])

  useEffect(() => {
    let live = true
    fetchSnapshot().then((next) => {
      if (!live) return
      setSnapshot(next)
      setFailure(null)
    }, (error: Error) => { if (live) setFailure(error.message) })
    return () => { live = false }
  }, [revision])

  useEffect(() => {
    const node = flowRef.current
    if (node === null) return
    const update = (): void => setMetrics(flowMetrics(node.clientWidth, rootFontSize()))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const flow = flowRef.current
    if (flow === null) return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.instance
        const handlers = id === undefined ? undefined : cards.current.get(id)
        if (handlers === undefined) continue
        if (entry.isIntersecting) handlers.resume()
        else handlers.pause()
      }
    }, { threshold: 0 })
    for (const node of flow.querySelectorAll('[data-instance]')) observer.observe(node)
    return () => observer.disconnect()
  }, [metrics, snapshot])

  const layout: FlowLayout | null = metrics === null || snapshot === null
    ? null
    : flowLayout(
      snapshot.board.instances.map((instance) => ({
        id: instance.id,
        height: heights[instance.id] ?? Math.round(metrics.columnWidth * PENDING_RATIO),
      })),
      metrics,
    )

  let body: ReactNode = null
  if (failure !== null) body = <div className="dsh-widget-board__notice">{failure}</div>
  else if (snapshot === null) body = <div className="dsh-widget-board__notice">正在读看板…</div>

  return (
    <div
      className="dsh-widget-board"
      data-dsh-widget-board-view={WIDGET_BOARD_PANEL_ID}
      data-flow-columns={metrics?.columns ?? 0}
    >
      {body}
      <div ref={flowRef} className="dsh-widget-board__flow" style={layout === null ? undefined : { height: layout.height }}>
        {snapshot === null || layout === null || metrics === null
          ? null
          : snapshot.board.instances.length === 0
            ? <div className="dsh-widget-board__notice">看板还没有卡片</div>
            : snapshot.board.instances.map((instance, index) => {
              const widget = snapshot.widgets[instance.widget]
              const placement = layout.placements[index]
              if (widget === undefined || placement === undefined) {
                return <div key={instance.id} className="dsh-widget-board__notice">{instance.widget} 引用了组件库里没有的组件</div>
              }
              return (
                <WidgetCard
                  key={`${instance.id}@${revision}`}
                  instance={instance}
                  widget={widget}
                  metrics={metrics}
                  placement={placement}
                  onHeight={onHeight}
                  controls={controls}
                />
              )
            })}
      </div>
    </div>
  )
}
