/**
 * 演示页的外壳：第一屏是真实的看板，其后是录屏位、三个要点与安装（D25）。
 *
 * 看板由插件的浏览器半边画（`host.page()` 是它注册到中栏的页面）；这里只管看板外面的东西：
 * 标题、语言与浅深切换、恢复默认看板，以及后面三屏。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { HOST_DATA_FILE } from '../data'
import type { HostData, UnsupportedWidget } from '../data'
import { clearStored } from '../storage'
import { startHost } from './boot'
import { text } from './copy'
import type { CopyKey, Lang } from './copy'
import { FilesFigure, ProviderFigure, SandboxFigure } from './figures'
import type { DemoHost } from './host'

const REPOSITORY = 'https://github.com/Nwflower/dsh-widget-board'
const REGISTRY = 'https://www.npmjs.com/package/dsh-widget-board'
const INSTALL_COMMAND = 'dsh plugin add dsh-widget-board'

type Theme = 'light' | 'dark'

/** 启动的进展：启动中、已就绪、失败（带原因）。 */
type Boot = { status: 'starting' } | { status: 'ready', host: DemoHost } | { status: 'failed', reason: string }

/** 浏览器里记住的偏好；存储不可用时（隐私窗口）偏好只在本次访问里生效，读不到就是没有。 */
function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** 记住一项偏好；存储不可用时丢弃，页面照常工作。 */
function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 隐私窗口里没有存储：偏好留在这次访问的内存里。
  }
}

/** 插件按文档的 `lang` 取界面语言：看板挂载或重新挂载之前，渲染之前就要定下来。 */
function applyLang(lang: Lang): void {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
}

function initialLang(): Lang {
  const stored = remembered('demo-lang')
  if (stored === 'zh' || stored === 'en') return stored
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function initialTheme(): Theme {
  const stored = remembered('demo-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 录屏的相对路径：写在 index.html 的 `demo-recording` 里，换一个视频不需要重新构建。 */
function recordingSource(): string {
  const meta = document.head.querySelector('meta[name="demo-recording"]')
  return meta?.getAttribute('content') ?? ''
}

/** 录屏文件在不在：静态托管对不存在的文件回 404，或者回一份 HTML 当兜底。 */
async function recordingExists(source: string): Promise<boolean> {
  const response = await fetch(source, { method: 'HEAD' })
  return response.ok && !(response.headers.get('content-type') ?? '').includes('text/html')
}

function Icon({ theme }: { theme: Theme }): ReactNode {
  return theme === 'dark'
    ? (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
    : (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M16.5 11.8A6.8 6.8 0 0 1 8.2 3.5a6.8 6.8 0 1 0 8.3 8.3Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      )
}

/** 录屏位：有视频就播，没有就写明视频该放在哪儿，并列出录屏的分镜。 */
function Recording({ lang }: { lang: Lang }): ReactNode {
  const source = recordingSource()
  const [present, setPresent] = useState<boolean | null>(source === '' ? false : null)
  useEffect(() => {
    if (source === '') return
    let live = true
    recordingExists(source).then((found) => { if (live) setPresent(found) }, () => { if (live) setPresent(false) })
    return () => { live = false }
  }, [source])
  const steps: CopyKey[] = ['step1', 'step2', 'step3', 'step4', 'step5']
  return (
    <section className="demo-section" aria-labelledby="demo-recording-title" data-demo-section="recording">
      <h2 id="demo-recording-title">{text('recordingTitle', lang)}</h2>
      <p className="demo-lead">{text('recordingLead', lang)}</p>
      {present === true
        ? <video className="demo-video" src={source} controls preload="metadata" playsInline data-demo-recording="video" />
        : (
            <div className="demo-video demo-video--empty" data-demo-recording="placeholder">
              <div className="demo-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28"><path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" /></svg></div>
              <strong>{text('recordingPlaceholder', lang)}</strong>
              <ol>
                {steps.map((step) => <li key={step}>{text(step, lang)}</li>)}
              </ol>
              <p>{text('recordingMissing', lang)}</p>
            </div>
          )}
    </section>
  )
}

/** 三个要点，各配一张图。 */
function Points({ lang }: { lang: Lang }): ReactNode {
  const points: Array<{ title: CopyKey, body: CopyKey, figure: ReactNode }> = [
    { title: 'point1Title', body: 'point1Body', figure: <FilesFigure lang={lang} /> },
    { title: 'point2Title', body: 'point2Body', figure: <SandboxFigure lang={lang} /> },
    { title: 'point3Title', body: 'point3Body', figure: <ProviderFigure lang={lang} /> },
  ]
  return (
    <section className="demo-section" aria-labelledby="demo-points-title" data-demo-section="points">
      <h2 id="demo-points-title">{text('pointsTitle', lang)}</h2>
      <div className="demo-points">
        {points.map((point, at) => (
          <article key={point.title} className="demo-point">
            <div className="demo-figure">{point.figure}</div>
            <h3><span className="demo-point__index">{at + 1}</span>{text(point.title, lang)}</h3>
            <p>{text(point.body, lang)}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

/** 安装命令与仓库链接。 */
function Install({ lang }: { lang: Lang }): ReactNode {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    navigator.clipboard.writeText(INSTALL_COMMAND).then(() => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1600)
    }, () => {
      // 剪贴板被浏览器拒绝时命令仍显示在页面上，读者可以手动选中复制。
    })
  }
  return (
    <section className="demo-section demo-install" aria-labelledby="demo-install-title" data-demo-section="install">
      <h2 id="demo-install-title">{text('installTitle', lang)}</h2>
      <p className="demo-lead">{text('installLead', lang)}</p>
      <div className="demo-command">
        <code>{INSTALL_COMMAND}</code>
        <button type="button" onClick={copy}>{copied ? text('copied', lang) : text('copy', lang)}</button>
      </div>
      <p className="demo-links">
        <a href={REGISTRY} target="_blank" rel="noreferrer">{text('package', lang)} · npmjs.com/package/dsh-widget-board</a>
        <a href={REPOSITORY} target="_blank" rel="noreferrer">{text('repository', lang)} · github.com/Nwflower/dsh-widget-board</a>
        <span>{text('license', lang)}</span>
      </p>
    </section>
  )
}

/** 演示页没有放进看板的组件，写成一句话。 */
function leftOut(widgets: UnsupportedWidget[], lang: Lang): string {
  return widgets.map((widget) => widget.title[lang]).join(lang === 'zh' ? '、' : ', ')
}

export function App(): ReactNode {
  const [lang, setLang] = useState<Lang>(() => {
    const initial = initialLang()
    applyLang(initial)
    return initial
  })
  const changeLang = (next: Lang): void => {
    applyLang(next)
    setLang(next)
  }
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [boot, setBoot] = useState<Boot>({ status: 'starting' })
  const [unsupported, setUnsupported] = useState<UnsupportedWidget[]>([])
  const [resetting, setResetting] = useState(false)
  const mounted = useRef(false)

  useLayoutEffect(() => {
    document.title = text('title', lang)
    document.head.querySelector('meta[name="description"]')?.setAttribute('content', text('description', lang))
    remember('demo-lang', lang)
  }, [lang])

  // 令牌从 body 的计算值解析，所以先改 body，再通知插件重新解析。
  useLayoutEffect(() => {
    document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark')
    document.documentElement.style.colorScheme = theme
    remember('demo-theme', theme)
    if (boot.status === 'ready') boot.host.themeChanged()
  }, [theme, boot])

  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    startHost().then(
      (host) => { setBoot({ status: 'ready', host }) },
      (error: unknown) => { setBoot({ status: 'failed', reason: error instanceof Error ? error.message : String(error) }) },
    )
    fetch(HOST_DATA_FILE).then(async (response) => {
      const data = await response.json() as HostData
      setUnsupported(data.unsupported)
    }, () => {})
  }, [])

  const reset = useCallback(() => {
    setResetting(true)
    clearStored().then(() => { window.location.reload() }, () => { setResetting(false) })
  }, [])

  const Page = boot.status === 'ready' ? boot.host.page() : undefined
  return (
    <>
      <header className="demo-header">
        <div className="demo-brand">
          <span className="demo-brand__mark" aria-hidden="true" />
          <div>
            <h1>{text('brand', lang)}</h1>
            <p>{text('tagline', lang)}</p>
          </div>
        </div>
        <div className="demo-controls">
          <div className="demo-segment" role="group" aria-label={text('language', lang)}>
            <button type="button" aria-pressed={lang === 'zh'} onClick={() => { changeLang('zh') }}>中文</button>
            <button type="button" aria-pressed={lang === 'en'} onClick={() => { changeLang('en') }}>English</button>
          </div>
          <button type="button" className="demo-icon" data-demo-theme={theme} aria-label={theme === 'dark' ? text('themeToLight', lang) : text('themeToDark', lang)} onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark') }}>
            <Icon theme={theme} />
          </button>
          <button type="button" className="demo-reset" disabled={resetting} onClick={reset}>{resetting ? text('resetting', lang) : text('reset', lang)}</button>
        </div>
      </header>
      <main>
        <section className="demo-stage" aria-label={text('boardLabel', lang)} data-demo-section="board">
          <div className="demo-board">
            <div className="demo-frame">
              {Page !== undefined && <Page key={lang} />}
              {boot.status === 'starting' && <p className="demo-status" role="status">{text('starting', lang)}</p>}
              {boot.status === 'failed' && (
                <div className="demo-status demo-status--failed" role="alert">
                  <strong>{text('startFailed', lang)}</strong>
                  <span>{boot.reason}</span>
                  <span>{text('startFailedHint', lang)}</span>
                </div>
              )}
            </div>
          </div>
          <p className="demo-hint">
            {text('boardHint', lang)}
            {unsupported.length > 0 && ` ${text('boardNoteIntro', lang)}${leftOut(unsupported, lang)}${text('boardNoteOutro', lang)}`}
          </p>
        </section>
        <Recording lang={lang} />
        <Points lang={lang} />
        <Install lang={lang} />
      </main>
    </>
  )
}
