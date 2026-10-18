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
  /** 所在的看板没有被选中：整组暂停（D21）。 */
  pausedByBoard: boolean
  /** 组件发到看板栏上的一条通知（D7）。 */
  onNotify: (instance: BoardInstance, widget: WidgetSummary, notification: WidgetNotification) => void
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
 * 同一个盒子，指针移上去转背面、离开转正面。原型阶段两面固定为宿主建组时选的两个组件。
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
  onRemoveGroup,
  pausedByBoard,
  controls,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: FlipGroupCardProps): ReactNode {
  const [hovered, setHovered] = useState(false)
  const [paused, setPaused] = useState(false)
  const flipped = hovered
  const content: GridPlacement = { id: front.id, x: 0, y: 0, width: placement.width, height: placement.height, columns: placement.columns }

  useEffect(() => controls.register(front.id, {
    pause: () => setPaused(true),
    resume: () => setPaused(false),
  }), [controls, front.id])

  return (
    <CardShell
      id={front.id}
      placement={placement}
      gesture={gesture}
      exiting={exiting}
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
          <div className="dsh-widget-board__flip-face dsh-widget-board__flip-face--front" aria-hidden={flipped}>
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
                  paused={pausedByBoard || paused || flipped}
                />
              )}
          </div>
          <div className="dsh-widget-board__flip-face dsh-widget-board__flip-face--back" aria-hidden={!flipped}>
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
                  paused={pausedByBoard || paused || !flipped}
                />
              )}
          </div>
        </div>
      </div>
      {/* 指针在 iframe 上方时父文档收不到悬停，翻面靠这层透明的接指针面；组里的两张卡暂时是静态画面。 */}
      <div
        className="dsh-widget-board__flip-hover"
        data-dsh-widget-board-flip-hover=""
        aria-hidden="true"
        title={t('flipHint')}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      />
    </CardShell>
  )
}
