/**
 * 组件文档：把令牌、套件、组件自己的三份文件与运行时拼成一份 HTML（D3、D7）。
 *
 * 文档由插件路由按内容哈希提供，响应头带 CSP；运行时、组件脚本与套件都以内联的方式进文档，
 * 靠 nonce 通过 `script-src`。不用 `srcdoc`：那样组件能否运行会取决于宿主页面的 CSP。
 */
import { randomBytes } from 'node:crypto'
import type { WidgetRecord } from './library'

/** 一次文档请求要内联的三份共用资产，由构建写出、宿主启动时读入。 */
export interface DocumentAssets {
  tokensCss: string
  suiteCss: string
  runtimeJs: string
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
 * 一份组件的文档。
 *
 * @param record - 组件记录（manifest 与三份文件）。
 * @param assets - 令牌、套件与运行时。
 * @param nonce - 本次响应的 nonce。
 * @returns 完整的 HTML。
 */
export function buildDocument(record: WidgetRecord, assets: DocumentAssets, nonce: string): string {
  const markup = record.files.get('index.html')?.toString('utf8') ?? ''
  const style = record.files.get('style.css')?.toString('utf8') ?? ''
  const script = record.files.get('main.js')?.toString('utf8')
  const title = record.manifest.title.zh
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(title)}</title>
<style>${assets.tokensCss}</style>
<style>${assets.suiteCss}</style>
<style>${style}</style>
</head>
<body>
${markup}
<script nonce="${nonce}">${scriptSafe(assets.runtimeJs, '组件运行时')}</script>
${script === undefined ? '' : `<script nonce="${nonce}">${scriptSafe(script, `${record.manifest.id}/main.js`)}</script>`}
</body>
</html>
`
}

/**
 * 把一段文本放进 HTML 文本节点。
 *
 * @param text - 外来字符串。
 * @returns 转义后的文本。
 */
function escapeText(text: string): string {
  return text.replace(/[&<>]/g, (character) => (character === '&' ? '&amp;' : character === '<' ? '&lt;' : '&gt;'))
}
