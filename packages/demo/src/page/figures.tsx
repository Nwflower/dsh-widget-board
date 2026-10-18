/**
 * 三个要点的示意图：手绘的 SVG，颜色读页面的变量，浅色与深色下都读得清楚（D25）。
 *
 * 图里的文字取自 `copy.ts`，随页面语言切换；文件名、属性名与代码标识保持英文原样。
 */
import type { ReactNode } from 'react'
import { text } from './copy'
import type { Lang } from './copy'

interface FigureProps {
  lang: Lang
}

/** 箭头的端点标记，三张图共用同一个定义。 */
function Defs({ id }: { id: string }): ReactNode {
  return (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M1 1L8 5L1 9" className="fig-arrow-head" />
      </marker>
    </defs>
  )
}

/** 一枚文件小卡：圆角矩形、文件名与几道示意的行。 */
function FileChip({ x, y, name, lines }: { x: number, y: number, name: string, lines: number[] }): ReactNode {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="132" height="52" rx="10" className="fig-surface" />
      <text x="14" y="21" className="fig-mono fig-strong">{name}</text>
      {lines.map((width, at) => (
        <rect key={at} x="14" y={31 + at * 7} width={width} height="3.5" rx="1.75" className="fig-muted-fill" />
      ))}
    </g>
  )
}

/** 要点一：三份文件拼成一张卡片。 */
export function FilesFigure({ lang }: FigureProps): ReactNode {
  return (
    <svg viewBox="0 0 440 270" role="img" aria-label={text('figure1', lang)} className="fig">
      <Defs id="fig1-arrow" />
      <text x="20" y="26" className="fig-label">{text('figFiles', lang)}</text>
      <FileChip x={20} y={40} name="index.html" lines={[84, 62]} />
      <FileChip x={20} y={100} name="style.css" lines={[70, 90]} />
      <FileChip x={20} y={160} name="main.js" lines={[96, 54]} />
      <g transform="translate(20 222)">
        <rect width="132" height="30" rx="8" className="fig-dashed" />
        <text x="14" y="19.5" className="fig-mono fig-muted">widget.json</text>
      </g>
      <path d="M160 130 C190 130 196 130 224 130" className="fig-line" markerEnd="url(#fig1-arrow)" />
      <path d="M160 66 C196 66 200 112 224 124" className="fig-line" markerEnd="url(#fig1-arrow)" />
      <path d="M160 186 C196 186 200 148 224 136" className="fig-line" markerEnd="url(#fig1-arrow)" />
      <g transform="translate(232 40)">
        <rect width="188" height="212" rx="20" className="fig-surface fig-accent-stroke" />
        <circle cx="22" cy="22" r="4" className="fig-accent-fill" />
        <rect x="34" y="18" width="54" height="8" rx="4" className="fig-muted-fill" />
        <text x="20" y="72" className="fig-big">128</text>
        <text x="20" y="94" className="fig-muted fig-small">{text('figCard', lang)}</text>
        {[44, 70, 52, 88, 62, 98].map((height, at) => (
          <rect key={at} x={20 + at * 26} y={190 - height} width="16" height={height} rx="5" className={at === 5 ? 'fig-accent-fill' : 'fig-muted-fill'} />
        ))}
      </g>
    </svg>
  )
}

/** 要点二：沙箱 iframe、消息桥与按哈希的授权。 */
export function SandboxFigure({ lang }: FigureProps): ReactNode {
  return (
    <svg viewBox="0 0 440 270" role="img" aria-label={text('figure2', lang)} className="fig">
      <Defs id="fig2-arrow" />
      <rect x="12" y="12" width="416" height="150" rx="16" className="fig-surface" />
      <text x="28" y="36" className="fig-label">{text('figHost', lang)}</text>
      <g transform="translate(236 48)">
        <rect width="176" height="96" rx="12" className="fig-dashed fig-accent-stroke" />
        <text x="14" y="24" className="fig-mono fig-accent-text">sandbox="allow-scripts"</text>
        <rect x="14" y="40" width="64" height="8" rx="4" className="fig-muted-fill" />
        <rect x="14" y="56" width="104" height="8" rx="4" className="fig-muted-fill" />
        <text x="14" y="86" className="fig-mono fig-small fig-muted">{text('figFrame', lang)}</text>
      </g>
      <g transform="translate(28 60)">
        <rect width="112" height="72" rx="10" className="fig-fill-soft" />
        <rect x="14" y="16" width="52" height="8" rx="4" className="fig-muted-fill" />
        <rect x="14" y="34" width="82" height="8" rx="4" className="fig-muted-fill" />
      </g>
      <path d="M146 86 L228 86" className="fig-line" markerStart="url(#fig2-arrow)" markerEnd="url(#fig2-arrow)" />
      <text x="187" y="76" className="fig-small fig-muted" textAnchor="middle">{text('figBridge', lang)}</text>
      <g>
        <path d="M146 122 L196 122" className="fig-line fig-danger-stroke" />
        <path d="M204 114 L220 130 M220 114 L204 130" className="fig-line fig-danger-stroke" />
        <text x="187" y="146" className="fig-small fig-muted" textAnchor="middle">{text('figNoNet', lang)} · connect-src 'none'</text>
      </g>
      <g transform="translate(12 184)">
        <rect width="190" height="74" rx="14" className="fig-surface" />
        <text x="16" y="24" className="fig-mono fig-strong">sha256:3f9a…c1</text>
        <rect x="16" y="38" width="86" height="22" rx="11" className="fig-ok-fill" />
        <text x="59" y="53.5" className="fig-small fig-ok-text" textAnchor="middle">{text('figGranted', lang)}</text>
      </g>
      <path d="M206 221 L234 221" className="fig-line" markerEnd="url(#fig2-arrow)" />
      <text x="220" y="210" className="fig-small fig-muted" textAnchor="middle">{text('figEdit', lang)}</text>
      <g transform="translate(238 184)">
        <rect width="190" height="74" rx="14" className="fig-surface" />
        <text x="16" y="24" className="fig-mono fig-strong">sha256:b07e…52</text>
        <rect x="16" y="38" width="110" height="22" rx="11" className="fig-warn-fill" />
        <text x="71" y="53.5" className="fig-small fig-warn-text" textAnchor="middle">{text('figNeedsGrant', lang)}</text>
      </g>
    </svg>
  )
}

/** 要点三：提供方插件、服务版本协商与占位卡片。 */
export function ProviderFigure({ lang }: FigureProps): ReactNode {
  return (
    <svg viewBox="0 0 440 270" role="img" aria-label={text('figure3', lang)} className="fig">
      <Defs id="fig3-arrow" />
      <g transform="translate(14 34)">
        <rect width="124" height="86" rx="14" className="fig-surface" />
        <text x="14" y="26" className="fig-label">{text('figProvider', lang)}</text>
        <text x="14" y="50" className="fig-mono fig-small fig-strong">registerWidgetType</text>
        <text x="14" y="68" className="fig-mono fig-small fig-muted">apiVersion: 3</text>
      </g>
      <path d="M142 77 L170 77" className="fig-line" markerEnd="url(#fig3-arrow)" />
      <g transform="translate(174 34)">
        <rect width="118" height="86" rx="14" className="fig-surface fig-accent-stroke" />
        <text x="59" y="28" className="fig-mono fig-small fig-strong" textAnchor="middle">{text('figService', lang)}</text>
        <rect x="14" y="40" width="90" height="16" rx="8" className="fig-ok-fill" />
        <text x="59" y="52" className="fig-small fig-ok-text" textAnchor="middle">{text('figNegotiate', lang)} ✓</text>
        <text x="59" y="74" className="fig-mono fig-small fig-muted" textAnchor="middle">host ⇄ browser</text>
      </g>
      <path d="M296 77 L324 77" className="fig-line" markerEnd="url(#fig3-arrow)" />
      <g transform="translate(328 34)">
        <rect width="100" height="86" rx="14" className="fig-surface" />
        <text x="14" y="26" className="fig-label">{text('figBoard', lang)}</text>
        <rect x="14" y="40" width="34" height="32" rx="7" className="fig-accent-fill" />
        <rect x="54" y="40" width="34" height="32" rx="7" className="fig-muted-fill" />
      </g>
      <g transform="translate(14 152)">
        <rect width="124" height="86" rx="14" className="fig-dashed fig-danger-stroke" />
        <text x="14" y="26" className="fig-label fig-danger-text">{text('figUnplugged', lang)}</text>
        <path d="M30 56 L56 56 M70 56 L94 56" className="fig-line fig-danger-stroke" />
        <path d="M54 46 L72 66" className="fig-line fig-danger-stroke" />
      </g>
      <path d="M142 195 L324 195" className="fig-line fig-dashed-line" markerEnd="url(#fig3-arrow)" />
      <g transform="translate(328 152)">
        <rect width="100" height="86" rx="14" className="fig-surface" />
        <rect x="14" y="14" width="72" height="58" rx="10" className="fig-dashed" />
        <text x="50" y="40" className="fig-small fig-muted" textAnchor="middle">{text('figPlaceholder', lang)}</text>
        <text x="50" y="58" className="fig-mono fig-small fig-muted" textAnchor="middle">…</text>
      </g>
    </svg>
  )
}
