import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { GridPlacement } from '@dsh-widget-board/model'
import tokens from '@dsh-widget-board/contracts/tokens.json'
import { t } from './copy'

/**
 * 卡片的圆角来自令牌。iframe 的文档画布在卡片自己的圆角之外是白的，外壳要把它裁掉：
 * `border-radius` 裁不动 iframe 的内容，只有 `clip-path` 才裁得动。裁剪的圆角比卡片自己的
 * 大一点，组件画出来的边因此完整落在裁剪之内，两个圆角的接缝不会露出画布。
 */
export const CARD_RADIUS = (tokens as { radius: { card: string } }).radius.card
/** 卡片看得见的边缘：iframe 裁在比卡片自己的圆角大 2px 的弧上，缩放手柄也贴着这条弧。 */
export const CARD_CLIP_RADIUS = `calc(${CARD_RADIUS} + 2px)`
export const CARD_CLIP = `inset(0 round ${CARD_CLIP_RADIUS})`

/** 卡片外壳要画的东西。 */
export interface CardShellProps {
  /** 卡片实例的 id；组卡用正面的 id。 */
  id: string
  placement: GridPlacement
  gesture: 'move' | 'resize' | null
  /** 这张卡正在退场：外壳只画动画，指针不再接。 */
  exiting: boolean
  /** 打开这张卡的设置；省略时不画设置按钮。 */
  onSettings?: (button: HTMLButtonElement) => void
  onRemove: () => void
  onDragStart: (event: ReactPointerEvent<HTMLElement>, id: string, kind: 'move' | 'resize') => void
  onDragMove: (event: ReactPointerEvent<HTMLElement>) => void
  onDragEnd: (event: ReactPointerEvent<HTMLElement>) => void
  onDragCancel: () => void
  children: ReactNode
}

/**
 * 一张卡的外壳：一个定位的盒子、拖动把手、移除按钮、缩放手柄与实时尺寸。
 *
 * 画面由调用方放进 children；普通卡片放一个组件文档，翻面组放两层画面。
 *
 * @param props - 盒子、手势与子画面。
 * @returns 卡片外壳。
 */
export function CardShell({
  id,
  placement,
  gesture,
  exiting,
  onSettings,
  onRemove,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  children,
}: CardShellProps): ReactNode {
  const dragProps = {
    onPointerMove: onDragMove,
    onPointerUp: onDragEnd,
    onPointerCancel: onDragCancel,
    onLostPointerCapture: onDragCancel,
  }
  const readout = (
    <>
      <span className="dsh-widget-board__measure-size">
        {Math.round(placement.width)}
        <i> × </i>
        {Math.round(placement.height)}
      </span>
      <span className="dsh-widget-board__measure-hint">
        <span className="dsh-widget-board__dot" />
        {gesture === 'resize' ? t('resizeHint') : t('moveHint')}
      </span>
    </>
  )
  return (
    <div
      className="dsh-widget-board__cell"
      data-instance={id}
      data-gesture={gesture ?? undefined}
      data-exiting={exiting ? 'true' : undefined}
      style={{ left: placement.x, top: placement.y, width: placement.width, height: placement.height, borderRadius: CARD_RADIUS }}
    >
      {children}
      <div
        className="dsh-widget-board__grip"
        data-dsh-widget-board-handle="move"
        title={t('move')}
        onPointerDown={(event) => onDragStart(event, id, 'move')}
        {...dragProps}
      />
      {onSettings === undefined
        ? null
        : (
          <button
            type="button"
            className="dsh-widget-board__settings"
            data-dsh-widget-board-handle="settings"
            title={t('cardSettings')}
            aria-label={t('cardSettings')}
            disabled={exiting}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => onSettings(event.currentTarget)}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d="M3 5h10M3 8h10M3 11h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="6" cy="5" r="1.6" fill="currentColor" />
              <circle cx="10" cy="8" r="1.6" fill="currentColor" />
              <circle cx="7" cy="11" r="1.6" fill="currentColor" />
            </svg>
          </button>
        )}
      <button
        type="button"
        className="dsh-widget-board__remove"
        data-dsh-widget-board-handle="remove"
        title={t('remove')}
        aria-label={t('remove')}
        disabled={exiting}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onRemove}
      >
        ×
      </button>
      <div
        className="dsh-widget-board__resize"
        data-dsh-widget-board-handle="resize"
        title={t('resize')}
        onPointerDown={(event) => onDragStart(event, id, 'resize')}
        {...dragProps}
      >
        <svg className="dsh-widget-board__resize-arc" viewBox="0 0 48 48" aria-hidden="true">
          <path d="M24 48A24 24 0 0 0 48 24" />
        </svg>
      </div>
      {gesture === null
        ? null
        : gesture === 'resize'
          ? (
            <div className="dsh-widget-board__mask" data-dsh-widget-board-measure="" aria-hidden="true">
              <div className="dsh-widget-board__mask-readout">{readout}</div>
            </div>
          )
          : (
            <div className="dsh-widget-board__measure" data-dsh-widget-board-measure="" aria-hidden="true">
              {readout}
            </div>
          )}
    </div>
  )
}
