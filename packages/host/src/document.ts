/**
 * 组件文档：把令牌、套件、组件自己的文件与运行时拼成一份 HTML（D3、D7）。
 *
 * 文档由插件路由按内容哈希提供，响应头带 CSP；运行时、组件脚本与套件都以内联的方式进文档，
 * 靠 nonce 通过 `script-src`。不用 `srcdoc`：那样组件能否运行会取决于宿主页面的 CSP。
 *
 * 组件目录里的图片与字体不能自己发请求（CSP 只允许 `data:` 与 `blob:`），所以作者在这三份文件里
 * 写 `{{asset:相对路径}}`，宿主在拼文档时换成 `data:` 地址。路径不在组件目录里、或文件不存在，
 * 直接报错：一份缺图的文档比一次启动失败更难查。
 */
import { randomBytes } from 'node:crypto'
import type { LocalizedText } from '@dsh-widget-board/contracts'
import type { WidgetRecord } from './library'

/** 一次文档请求要内联的三份共用资产，由构建写出、宿主启动时读入。 */
export interface DocumentAssets {
  tokensCss: string
  suiteCss: string
  runtimeJs: string
}

/** 拼一份文档时要的界面语言。 */
export interface DocumentOptions {
  /** 宿主的界面语言，如 `zh-CN`。 */
  lang: string
}

/** 资源占位符：`{{asset:logo.svg}}`。 */
const ASSET = /\{\{asset:([^}]+)\}\}/g

/** 认识的资源类型；其余按二进制流给出。 */
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
}

/**
 * 这一份文档的 CSP。
 *
 * @param nonce - 本次响应的 nonce。
 * @returns `content-security-policy` 头的值。
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
}

/** 一份新的 nonce。 */
export function freshNonce(): string {
  return randomBytes(16).toString('base64')
}

/**
 * 内联进 `<script>` 的文本不能带结束标签，否则文档被提前截断。
 *
 * @param code - 脚本文本。
 * @param subject - 出错时点名的文件。
 * @returns 原文本。
 */
function scriptSafe(code: string, subject: string): string {
  if (/<\/script/i.test(code)) throw new Error(`${subject} 里出现 </script，不能内联进文档`)
  return code
}

/**
 * 内联进 `<style>` 的文本同样不能带结束标签。
 *
 * @param css - 样式文本。
 * @param subject - 出错时点名的文件。
 * @returns 原文本。
 */
function styleSafe(css: string, subject: string): string {
  if (/<\/style/i.test(css)) throw new Error(`${subject} 里出现 </style，不能内联进文档`)
  return css
}

/**
 * 把 `{{asset:…}}` 换成 `data:` 地址。
 *
 * @param text - 组件文件的内容。
 * @param record - 组件记录，资源从它的文件表里取。
 * @param subject - 出错时点名的文件。
 * @returns 换好的文本。
 */
function inlineAssets(text: string, record: WidgetRecord, subject: string): string {
  return text.replace(ASSET, (_match, raw: string) => {
    const path = raw.trim().replace(/^\.\//, '')
    if (path === '' || path.includes('..') || path.startsWith('/')) {
      throw new Error(`${subject} 里的资源路径 ${raw} 不在组件目录内`)
    }
    const content = record.files.get(path)
    if (content === undefined) throw new Error(`${subject} 引用的资源 ${path} 不在组件目录里`)
    const extension = path.split('.').pop()?.toLowerCase() ?? ''
    const mime = MIME[extension] ?? 'application/octet-stream'
    return `data:${mime};base64,${content.toString('base64')}`
  })
}

/**
 * 一段双语文案按当前语言取一条。
 *
 * @param text - 文案。
 * @param lang - 宿主的界面语言。
 * @returns 要显示的那一条。
 */
function textOf(text: LocalizedText, lang: string): string {
  return lang.toLowerCase().startsWith('zh') ? text.zh : text.en
}

/**
 * 一份组件的文档。
 *
 * @param record - 组件记录（manifest 与组件文件）。
 * @param assets - 令牌、套件与运行时。
 * @param nonce - 本次响应的 nonce。
 * @param options - 界面语言。
 * @returns 完整的 HTML。
 */
export function buildDocument(record: WidgetRecord, assets: DocumentAssets, nonce: string, options: DocumentOptions): string {
  const name = record.manifest.id
  const markup = inlineAssets(record.files.get('index.html')?.toString('utf8') ?? '', record, `${name}/index.html`)
  const style = inlineAssets(record.files.get('style.css')?.toString('utf8') ?? '', record, `${name}/style.css`)
  const rawScript = record.files.get('main.js')?.toString('utf8')
  const script = rawScript === undefined ? undefined : inlineAssets(rawScript, record, `${name}/main.js`)
  return `<!doctype html>
<html lang="${escapeText(options.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(textOf(record.manifest.title, options.lang))}</title>
<style>${styleSafe(assets.tokensCss, '组件运行时令牌')}</style>
<style>${styleSafe(assets.suiteCss, '组件套件')}</style>
<style>${styleSafe(style, `${name}/style.css`)}</style>
</head>
<body>
${markup}
<script nonce="${nonce}">${scriptSafe(assets.runtimeJs, '组件运行时')}</script>
${script === undefined ? '' : `<script nonce="${nonce}">${scriptSafe(script, `${name}/main.js`)}</script>`}
</body>
</html>
`
}

/**
 * 把一段文本放进 HTML 文本节点或属性值。
 *
 * @param text - 外来字符串。
 * @returns 转义后的文本。
 */
function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (character) => {
    if (character === '&') return '&amp;'
    if (character === '<') return '&lt;'
    if (character === '>') return '&gt;'
    if (character === '"') return '&quot;'
    return '&#39;'
  })
}
