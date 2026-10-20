import { useEffect, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { BoardInstance, WidgetNotification, WidgetSummary } from '@dsh-widget-board/contracts'
import type { GridPlacement } from '@dsh-widget-board/model'
import type { CardControls } from './card'
import { CardShell } from './card-shell'
import { CardSurface } from './card-surface'
import { t } from './copy'
import type { FrameHost } from './frame-host'
import type { ShellTheme } from './theme'

/** 一张翻面组要画的东西。 */
export interface FlipGroupCardProps {
  front: BoardInstance
  back: BoardInstance
  frontWidget: WidgetSummary | undefined
  backWidget: WidgetSummary | undefined
  placement: GridPlacement
  gesture: 'move' | 'resize' | null
  /** 整组正在退场：外壳画删除动画。 */
  exiting: boolean
  theme: ShellTheme
  frames: FrameHost
  onState: (id: string, patch: unknown) => Promise<void>
  /** 组件发到看板栏上的一条通知（D7）。 */
  onNotify: (instance: BoardInstance, widget: WidgetSummary, notification: WidgetNotification) => void
  /** 打开整组的设置：槽条里挑两个槽的组件（D22）。 */
  onSettings?: (button: HTMLButtonElement) => void
  /** 整组一起移除（D19）。 */
  onRemoveGroup: () => void
  controls: CardControls
  onDragStart: (event: ReactPointerEvent<HTMLElement>, id: string, kind: 'move' | 'resize') => void
  onDragMove: (event: ReactPointerEvent<HTMLElement>) => void
  onDragEnd: (event: ReactPointerEvent<HTMLElement>) => void
  onDragCancel: () => void
}

/** 一层画面没有对应的组件时露出的占位。 */
function MissingFace({ instance }: { instance: BoardInstance }): ReactNode {
  return (
    <div className="dsh-widget-board__flip-missing">
      <p>{t('unavailable')}</p>
      <p>{instance.widget}</p>
    </div>
  )
}

/**
 * 固定的翻面组（D19）：一个卡片外壳里放两个普通组件画面，正面与背面各一张卡。
 *
 * 两张卡仍是看板上的普通实例，各自的 props、data、state 与实例路由不变；组只负责把两层画面放进
 * 同一个盒子，指针移上去转背面、离开转正面。两面各放哪个组件由设置弹窗的槽条选（D22）。
 *
 * @param props - 正反两张卡、它们的元信息、盒子与回调。
 * @returns 翻面组。
 */
export function FlipGroupCard({
  front,
  back,
  frontWidget,
  backWidget,
  placement,
  gesture,
  exiting,
  theme,
  frames,
  onState,
  onNotify,
  onSettings,
  onRemoveGroup,
  controls,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: FlipGroupCardProps): ReactNode {
  const [focusWithin, setFocusWithin] = useState(false)
  const [showBack, setShowBack] = useState(false)
  const [paused, setPaused] = useState(false)
  // 翻面只有一个入口：右上角那枚按钮。指针停在卡片上时，两张画面各自要接自己的点击，接指针的
  // 悬停层会把这些点击吃掉（D19），所以翻面不再挂在悬停上。
  const flipped = showBack || focusWithin
  const content: GridPlacement = { id: front.id, x: 0, y: 0, width: placement.width, height: placement.height, columns: placement.columns }

  useEffect(() => controls.register(front.id, {
    pause: () => setPaused(true),
    resume: () => setPaused(false),
  }), [controls, front.id])

  /**
   * 藏起来的那一面不接指针，也不进 Tab 顺序：`inert` 写在属性上，React 的类型里还没有它。
   *
   * @param hidden - 这一面现在藏起来了。
   * @returns 给 `ref` 的回调。
   */
  const inertWhen = (hidden: boolean) => (node: HTMLDivElement | null): void => {
    if (node !== null) node.toggleAttribute('inert', hidden)
  }

  return (
    <CardShell
      id={front.id}
      placement={placement}
      gesture={gesture}
      exiting={exiting}
      {...(onSettings === undefined ? {} : { onSettings })}
      onRemove={onRemoveGroup}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div
        className="dsh-widget-board__flip-group"
        data-dsh-widget-board-flip-group={front.group?.id}
        data-flipped={flipped ? 'true' : undefined}
      >
        <div className={`dsh-widget-board__flip-inner${flipped ? ' is-flipped' : ''}`}>
          <div
            className="dsh-widget-board__flip-face dsh-widget-board__flip-face--front"
            aria-hidden={flipped}
            ref={inertWhen(flipped)}
            onFocusCapture={() => setFocusWithin(true)}
            onBlurCapture={() => setFocusWithin(false)}
          >
            {frontWidget === undefined
              ? <MissingFace instance={front} />
              : (
                <CardSurface
                  instance={front}
                  widget={frontWidget}
                  placement={content}
                  theme={theme}
                  frames={frames}
                  onState={onState}
                  onNotify={onNotify}
                  paused={paused || flipped}
                />
              )}
          </div>
          <div
            className="dsh-widget-board__flip-face dsh-widget-board__flip-face--back"
            aria-hidden={!flipped}
            ref={inertWhen(!flipped)}
            onFocusCapture={() => setFocusWithin(true)}
            onBlurCapture={() => setFocusWithin(false)}
          >
            {backWidget === undefined
              ? <MissingFace instance={back} />
              : (
                <CardSurface
                  instance={back}
                  widget={backWidget}
                  placement={content}
                  theme={theme}
                  frames={frames}
                  onState={onState}
                  onNotify={onNotify}
                  paused={paused || !flipped}
                />
              )}
          </div>
        </div>
      </div>
      {/* 触屏与键盘的翻面入口：点一下换到另一面，再点一下换回来。 */}
      <button
        type="button"
        className="dsh-widget-board__flip-toggle"
        data-dsh-widget-board-handle="flip"
        title={showBack ? t('flipFront') : t('flipBack')}
        aria-label={showBack ? t('flipFront') : t('flipBack')}
        aria-pressed={showBack}
        disabled={exiting}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setShowBack(!showBack)}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M3.5 6.5A5 5 0 0 1 12.6 5M12.5 9.5A5 5 0 0 1 3.4 11" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M12.8 2.8v2.6h-2.6M3.2 13.2v-2.6h2.6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </CardShell>
  )
}
