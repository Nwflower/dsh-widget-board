/**
 * 看板改名与删除的确认（D21、B1）。
 *
 * 两个弹窗都只盖看板页自己的矩形，落在页内浮层上，宿主侧栏照常可用；样子沿用设置弹窗的题头、
 * 表面、按钮与页脚，危险操作使用宿主的状态色并配文字说明。它们不自己做撤销，也不改宿主把选中的
 * 看板换到哪一块。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type { Board } from '@dsh-widget-board/contracts'
import { BOARD_TITLE_LIMIT, boardTitleLength, boardTitleProblem } from '@dsh-widget-board/contracts'
import { t } from '../copy'
import { factsOf, titleProblemText } from './actions'

/** 两块弹窗共用的层：按看板页的矩形定位，只盖看板内容（D1）。 */
interface LayerProps {
  anchor: HTMLElement | null
  children: ReactNode
  /** 按下背板时做什么。 */
  onDismiss: () => void
}

/**
 * 页内浮层：定位到看板页矩形，背板接住外部点击。
 *
 * 看板页挂上时锚点就已经在文档里，矩形在布局阶段量一次；量出来之前先按整页大小画，里面的弹窗因此
 * 第一帧就挂得上、接得到键盘。
 *
 * @param props - 锚点、内容与背板动作。
 * @returns 一层浮在看板页上的内容。
 */
function Layer({ anchor, children, onDismiss }: LayerProps): ReactNode {
  const [rect, setRect] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    if (anchor === null) return
    const update = (): void => { setRect(anchor.getBoundingClientRect()) }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(anchor)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [anchor])
  const box = rect === null
    ? { top: 0, left: 0, width: '100vw', height: '100vh' }
    : { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
  return (
    <div className="dsh-widget-board__board-dialog-layer" style={box}>
      <div className="dsh-widget-board__board-dialog-backdrop" onPointerDown={onDismiss} />
      {children}
    </div>
  )
}

/**
 * 把焦点圈在一层弹窗里，Escape 交给调用方。
 *
 * @param dialog - 弹窗的节点。
 * @param onEscape - 按下 Escape 时做什么。
 * @returns 拿开这层监听用的函数。
 */
function trapFocus(dialog: HTMLDivElement, onEscape: () => void): () => void {
  // Escape 挂在文档上：焦点偶尔落在弹窗外（例如刚打开的那一帧），也要能关掉。
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    event.preventDefault()
    onEscape()
  }
  const onTab = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return
    const nodes = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )
    const focusable = [...nodes].filter((node) => node.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0] as HTMLElement
    const last = focusable[focusable.length - 1] as HTMLElement
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  document.addEventListener('keydown', onKeyDown, true)
  dialog.addEventListener('keydown', onTab)
  return () => {
    document.removeEventListener('keydown', onKeyDown, true)
    dialog.removeEventListener('keydown', onTab)
  }
}

/** 改名弹窗要画的东西。 */
export interface RenameBoardDialogProps {
  board: Board
  anchor: HTMLElement | null
  /** 保存中：按钮不可按，输入框不再接受提交。 */
  busy: boolean
  /** 失败原因；失败的输入原样留在框里。 */
  failure: string | null
  /** 保存成功之后由外层关掉弹窗。 */
  onConfirm: (title: string) => void
  onCancel: () => void
}

/**
 * 给一块看板改名。输入预填当前名，Enter 保存、Escape 取消；中文输入法组合期间的 Enter 不保存。
 *
 * @param props - 看板、锚点、忙碌与失败状态、两个回调。
 * @returns 弹窗。
 */
export function RenameBoardDialog({ board, anchor, busy, failure, onConfirm, onCancel }: RenameBoardDialogProps): ReactNode {
  const [title, setTitle] = useState(board.title)
  const [touched, setTouched] = useState(false)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 弹窗挂上的这一帧就接键盘、把焦点放进输入框：外层浮层先以整页大小画出，这两件事不必等它量完。
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    inputRef.current?.focus()
    return trapFocus(dialog, onCancel)
  }, [onCancel])

  const problem = boardTitleProblem(title)
  const length = boardTitleLength(title.trim())
  const request = (): void => {
    if (busy) return
    setTouched(true)
    if (problem !== null) return
    onConfirm(title)
  }

  /** 组合期间的回车由输入法处理，这里不提交。 */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    request()
  }

  return (
    <Layer anchor={anchor} onDismiss={onCancel}>
      <div
        ref={dialogRef}
        className="dsh-widget-board__board-dialog dsh-widget-board__board-dialog--rename"
        data-dsh-widget-board-rename-board={board.id}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dsh-widget-board-rename-title"
      >
        <header className="dsh-widget-board__board-dialog-head">
          <p className="dsh-widget-board__board-dialog-eyebrow">{t('rename')}</p>
          <h2 id="dsh-widget-board-rename-title" className="dsh-widget-board__board-dialog-title">{t('renameBoardTitle')}</h2>
        </header>
        <div className="dsh-widget-board__board-dialog-body">
          <label className="dsh-widget-board__board-dialog-label" htmlFor="dsh-widget-board-rename-input">{t('boardName')}</label>
          <input
            id="dsh-widget-board-rename-input"
            ref={inputRef}
            className="dsh-widget-board__board-dialog-input"
            data-dsh-widget-board-rename-input=""
            value={title}
            disabled={busy}
            aria-invalid={touched && problem !== null}
            aria-describedby="dsh-widget-board-rename-foot"
            onChange={(event) => { setTitle(event.target.value); setTouched(false) }}
            onBlur={() => { setTouched(true) }}
            onKeyDown={onKeyDown}
          />
          <p
            id="dsh-widget-board-rename-foot"
            className="dsh-widget-board__board-dialog-note"
            data-dsh-widget-board-rename-note=""
            data-state={(touched || length > 0) && problem !== null ? 'error' : 'hint'}
          >
            {(touched || length > 0) && problem !== null
              ? titleProblemText(problem)
              : `${String(length)} / ${String(BOARD_TITLE_LIMIT)} ${t('boardTitleCount')}`}
          </p>
          {failure === null ? null : <p className="dsh-widget-board__board-dialog-note" data-state="error">{failure}</p>}
        </div>
        <footer className="dsh-widget-board__board-dialog-foot">
          <button type="button" className="dsh-widget-board__board-dialog-ghost" data-dsh-widget-board-rename-cancel="" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="dsh-widget-board__board-dialog-primary"
            data-dsh-widget-board-rename-save=""
            disabled={busy || problem !== null}
            onClick={() => { request() }}
          >
            {busy ? t('saving') : t('renameConfirm')}
          </button>
        </footer>
      </div>
    </Layer>
  )
}

/** 删除确认要画的东西。 */
export interface DeleteBoardDialogProps {
  board: Board
  anchor: HTMLElement | null
  /** 工作区里一共几块看板：只有一块时说明会补一块空的。 */
  boardCount: number
  busy: boolean
  failure: string | null
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 删除一块看板之前的确认：标题、几格、几张卡，删的是哪一块一眼看得出。
 *
 * @param props - 看板、锚点、看板总数、忙碌与失败状态、两个回调。
 * @returns 弹窗。
 */
export function DeleteBoardDialog({ board, anchor, boardCount, busy, failure, onConfirm, onCancel }: DeleteBoardDialogProps): ReactNode {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const facts = factsOf(board)

  // 焦点落在取消上：这一步删掉的东西不能撤销，默认按键不该是「删」。
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    cancelRef.current?.focus()
    return trapFocus(dialog, onCancel)
  }, [onCancel])

  return (
    <Layer anchor={anchor} onDismiss={onCancel}>
      <div
        ref={dialogRef}
        className="dsh-widget-board__board-dialog dsh-widget-board__board-dialog--delete"
        data-dsh-widget-board-delete-board={board.id}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dsh-widget-board-delete-title"
        aria-describedby="dsh-widget-board-delete-body"
      >
        <header className="dsh-widget-board__board-dialog-head">
          <p className="dsh-widget-board__board-dialog-eyebrow">{t('removeBoard')}</p>
          <h2 id="dsh-widget-board-delete-title" className="dsh-widget-board__board-dialog-title">{t('removeBoardTitle')}</h2>
        </header>
        <div className="dsh-widget-board__board-dialog-body" id="dsh-widget-board-delete-body">
          <p className="dsh-widget-board__board-dialog-target" data-dsh-widget-board-delete-name="">{board.title}</p>
          <p className="dsh-widget-board__board-dialog-counts">
            <span data-dsh-widget-board-delete-cells="">{t('cellsCount').replace('{n}', String(facts.cells))}</span>
            <span data-dsh-widget-board-delete-cards="">{t('cardsCount').replace('{n}', String(facts.cards))}</span>
          </p>
          <p className="dsh-widget-board__board-dialog-note">{t('deleteBoardWarning')}</p>
          {boardCount <= 1 ? <p className="dsh-widget-board__board-dialog-note">{t('deleteBoardLast')}</p> : null}
          {failure === null ? null : <p className="dsh-widget-board__board-dialog-note" data-state="error">{failure}</p>}
        </div>
        <footer className="dsh-widget-board__board-dialog-foot">
          <button
            ref={cancelRef}
            type="button"
            className="dsh-widget-board__board-dialog-ghost"
            data-dsh-widget-board-delete-cancel=""
            onClick={onCancel}
            disabled={busy}
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            className="dsh-widget-board__board-dialog-danger"
            data-dsh-widget-board-delete-confirm=""
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? t('deleteBoardBusy') : t('deleteBoardConfirm')}
          </button>
        </footer>
      </div>
    </Layer>
  )
}
