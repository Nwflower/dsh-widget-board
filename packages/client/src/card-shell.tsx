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
/** 裁剪用的圆角：比卡片自己的圆角大一点，接缝因此被组件自己的画面盖住。 */
export const CARD_CLIP = `inset(0 round calc(${CARD_RADIUS} + 2px))`

/** 卡片外壳要画的东西。 */
export interface CardShellProps {
  /** 卡片实例的 id；组卡用正面的 id。 */
  id: string
  placement: GridPlacement
  gesture: 'move' | 'resize' | null
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
  return (
    <div
      className="dsh-widget-board__cell"
      data-instance={id}
      data-gesture={gesture ?? undefined}
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
      <button
        type="button"
        className="dsh-widget-board__remove"
        data-dsh-widget-board-handle="remove"
        title={t('remove')}
        aria-label={t('remove')}
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
      />
      {gesture === null
        ? null
        : (
          <div className="dsh-widget-board__measure" data-dsh-widget-board-measure="" aria-hidden="true">
            <span className="dsh-widget-board__measure-size">
              {Math.round(placement.width)}
              <i> × </i>
              {Math.round(placement.height)}
            </span>
            <span className="dsh-widget-board__measure-hint">
              <span className="dsh-widget-board__dot" />
              {gesture === 'resize' ? t('resizeHint') : t('moveHint')}
            </span>
          </div>
        )}
    </div>
  )
}
