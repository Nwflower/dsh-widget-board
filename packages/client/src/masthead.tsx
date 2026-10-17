import type { ReactNode } from 'react'
import { isChinese, t } from './copy'

/**
 * 看板顶部的题头：一块活的看板（D16）。
 *
 * 题头只画外壳自己的东西：标题、说明、添加组件的按钮与右侧的字模图案。图案是装饰，读屏器跳过；
 * 颜色全部来自宿主令牌，浅色与深色各自可读（D10）。
 */
const ART = `  +   +   +   +   -   -   -   /   /   (   (   *   *   ▲   K   #
    +   +   +   -   -   -   -   /   /   (   (   *   ▲   ▲   K   K   #
      +   +   +   +   -   -   -   /   /   (   (   *   ▲   K   K   #   #
  +   +   +   +   +   -   -   -   /   /   (   (   *   *   ▲   K   #
      +   +   +   +   -   -   -   /   /   (   (   *   ▲   ▲   K   #
  +   +   +   +   +   +   -   -   -   /   /   (   (   *   ▲   K   #
    +   +   +   +   +   -   -   -   /   /   (   (   *   *   ▲   K   #
  +   +   +   +   +   +   -   -   -   /   /   (   (   *   ▲   #   #
      +   +   +   +   +   -   -   -   /   /   (   (   *   ▲   K   #
  +   +   +   +   +   +   +   -   -   -   /   /   (   (   *   K   #
    +   +   +   +   +   +   -   -   -   /   /   /   (   (   ▲   K   #
  +   +   +   +   +   +   +   -   -   -   /   /   /   (   *   K   #
      +   +   +   +   +   +   -   -   -   /   /   /   (   (   ▲   #`
  .split('\n')

/** 字模图案上的云：用题头自己的底色盖住中间一片，像一张被云挡住的图纸。 */
const CLOUD = 'M98 208c-40 0-68-26-68-59 0-33 26-58 61-58 8-42 44-70 88-70 42 0 77 27 88 65 34 3 60 29 60 61 0 36-30 61-68 61H98Z'

/** 看板的题头。 */
export interface BoardMastheadProps {
  /** 打开组件库面板。 */
  onAdd: () => void
  /** 面板已经打开：按钮换成收起的样子。 */
  open: boolean
}

/**
 * 看板的题头。
 *
 * @param props - 打开组件库的回调与面板的状态。
 * @returns 标题、说明、添加按钮与右侧的字模图案。
 */
export function BoardMasthead({ onAdd, open }: BoardMastheadProps): ReactNode {
  const zh = isChinese()
  return (
    <header className="dsh-widget-board__masthead" data-dsh-widget-board-masthead="">
      <div className="dsh-widget-board__masthead-copy">
        <p className="dsh-widget-board__eyebrow">BOARD · LIVE</p>
        <h1 className="dsh-widget-board__title">
          {zh
            ? <><span>一块</span><br /><span className="dsh-widget-board__accent">活的</span><span>看板</span></>
            : <><span>A </span><span className="dsh-widget-board__accent">living</span><br /><span>board</span></>}
        </h1>
        <p className="dsh-widget-board__tagline">
          <span className="dsh-widget-board__dot" aria-hidden="true" />
          {zh ? '独立工作、任何事情、自由排版' : 'Independent work, anything, free layout'}
        </p>
      </div>
      <div className="dsh-widget-board__masthead-actions">
        <button
          type="button"
          className="dsh-widget-board__add"
          data-dsh-widget-board-add-open=""
          aria-expanded={open}
          onClick={onAdd}
        >
          {t('add')}
        </button>
      </div>
      <div className="dsh-widget-board__art" aria-hidden="true">
        <pre className="dsh-widget-board__art-field">{ART.join('\n')}</pre>
        <svg className="dsh-widget-board__art-cloud" viewBox="0 0 520 260" preserveAspectRatio="none">
          <path d={CLOUD} />
        </svg>
      </div>
    </header>
  )
}
