import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { BoardSnapshot } from '@dsh-widget-board/contracts'
import { WIDGET_BOARD_PANEL_ID } from '@dsh-widget-board/contracts'
import type { GridMetrics } from '@dsh-widget-board/model'
import { metricsOf } from '@dsh-widget-board/model'
import type { CardControls } from './card'
import { WidgetCard } from './card'
import { fetchSnapshot } from './snapshot'

/** 根字号的像素值：行高与间距按它换算（D4）。 */
function rootFontSize(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}

/**
 * 中栏的看板页。
 *
 * 断点按这块容器的宽度判定，整页只有一个 ResizeObserver；离开视口的卡片由整页唯一的一个
 * IntersectionObserver 暂停（D4）。看板的内容来自宿主的一次快照（D5）。
 */
export function BoardPage(): ReactNode {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<GridMetrics | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const cards = useRef(new Map<string, { pause: () => void, resume: () => void }>())

  const controls = useMemo<CardControls>(() => ({
    register(id, handlers) {
      cards.current.set(id, handlers)
      return () => { cards.current.delete(id) }
    },
  }), [])

  useEffect(() => {
    let live = true
    fetchSnapshot().then((next) => { if (live) setSnapshot(next) }, (error: Error) => { if (live) setFailure(error.message) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    const node = containerRef.current
    if (node === null) return
    const update = (): void => setMetrics(metricsOf(node.clientWidth, rootFontSize()))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const grid = gridRef.current
    if (grid === null) return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.instance
        const handlers = id === undefined ? undefined : cards.current.get(id)
        if (handlers === undefined) continue
        if (entry.isIntersecting) handlers.resume()
        else handlers.pause()
      }
    }, { threshold: 0 })
    for (const node of grid.querySelectorAll('[data-instance]')) observer.observe(node)
    return () => observer.disconnect()
  }, [metrics, snapshot])

  let body: ReactNode = null
  if (failure !== null) {
    body = <div className="dsh-widget-board__notice">{failure}</div>
  } else if (snapshot === null || metrics === null) {
    body = <div className="dsh-widget-board__notice">正在读看板…</div>
  } else if (snapshot.board.instances.length === 0) {
    body = <div className="dsh-widget-board__notice">看板还没有卡片</div>
  } else {
    body = (
      <div
        ref={gridRef}
        className="dsh-widget-board__grid"
        style={{
          gridTemplateColumns: `repeat(${metrics.columns}, minmax(0, 1fr))`,
          gridAutoRows: `${metrics.rowHeight}px`,
          gap: `${metrics.gap}px`,
        }}
      >
        {snapshot.board.instances.map((instance) => {
          const widget = snapshot.widgets[instance.widget]
          if (widget === undefined) {
            return (
              <div key={instance.id} className="dsh-widget-board__cell" data-instance={instance.id} data-failure="">
                <div className="dsh-widget-board__failure">
                  <p className="dsh-widget-board__failure-title">{instance.widget}</p>
                  <p className="dsh-widget-board__failure-reason">看板上的这张卡引用了组件库里没有的组件</p>
                </div>
              </div>
            )
          }
          return <WidgetCard key={instance.id} instance={instance} widget={widget} metrics={metrics} controls={controls} />
        })}
      </div>
    )
  }

  return (
    <div className="dsh-widget-board" data-dsh-widget-board-view={WIDGET_BOARD_PANEL_ID} ref={containerRef}>
      {body}
    </div>
  )
}
