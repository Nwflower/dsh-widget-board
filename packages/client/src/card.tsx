import { useEffect, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { BoardInstance, WidgetNotification, WidgetSummary } from '@dsh-widget-board/contracts'
import type { GridPlacement } from '@dsh-widget-board/model'
import { CardShell } from './card-shell'
import { CardSurface } from './card-surface'
import type { FrameHost } from './frame-host'
import type { ShellTheme } from './theme'

/** 卡片向页面登记的暂停与恢复，由页面唯一的一个 IntersectionObserver 调用（D16）。 */
export interface CardControls {
  register(id: string, handlers: { pause: () => void, resume: () => void }): () => void
}

/** 一张卡片要画的东西。 */
export interface WidgetCardProps {
  instance: BoardInstance
  widget: WidgetSummary
  placement: GridPlacement
  /** 这张卡正在被拖动或缩放：指针事件归外壳，iframe 不接。 */
  gesture: 'move' | 'resize' | null
  /** 这张卡正在退场：外壳画删除动画。 */
  exiting: boolean
  /** 当前的主题；变化时推给组件（D10）。 */
  theme: ShellTheme
  /** 整页唯一的握手中心（D3）。 */
  frames: FrameHost
  /** 打开这张卡的设置（D27）；没有可配置项时不传。 */
  onSettings?: (button: HTMLButtonElement) => void
  /** 组件交出来的界面状态，看板写给宿主（D5）。 */
  onState: (id: string, patch: unknown) => Promise<void>
  /** 组件发到看板栏上的一条通知（D7）。 */
  onNotify: (instance: BoardInstance, widget: WidgetSummary, notification: WidgetNotification) => void
  /** 把这张卡从看板上移除。 */
  onRemove: (id: string) => void
  controls: CardControls
  /** 按下拖动把手或缩放手柄；位移、松手与取消都由同一个把手接收。 */
  onDragStart: (event: ReactPointerEvent<HTMLElement>, id: string, kind: 'move' | 'resize') => void
  onDragMove: (event: ReactPointerEvent<HTMLElement>) => void
  onDragEnd: (event: ReactPointerEvent<HTMLElement>) => void
  onDragCancel: () => void
}

/**
 * 一张卡片：卡片外壳加一层组件画面。
 *
 * 画面与外壳分开，翻面组因此能用同一个外壳装两层画面；普通卡片在一层画面上登记暂停与恢复。
 *
 * @param props - 实例、组件、盒子、手势与回调。
 * @returns 卡片。
 */
export function WidgetCard({
  instance,
  widget,
  placement,
  gesture,
  exiting,
  theme,
  frames,
  onSettings,
  onState,
  onNotify,
  onRemove,
  controls,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: WidgetCardProps): ReactNode {
  const [viewportPaused, setViewportPaused] = useState(false)

  useEffect(() => controls.register(instance.id, {
    pause: () => setViewportPaused(true),
    resume: () => setViewportPaused(false),
  }), [controls, instance.id])

  return (
    <CardShell
      id={instance.id}
      placement={placement}
      gesture={gesture}
      exiting={exiting}
      {...(onSettings === undefined ? {} : { onSettings })}
      onRemove={() => onRemove(instance.id)}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <CardSurface
        instance={instance}
        widget={widget}
        placement={placement}
        theme={theme}
        frames={frames}
        onState={onState}
        onNotify={onNotify}
        paused={viewportPaused}
      />
    </CardShell>
  )
}
