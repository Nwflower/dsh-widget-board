/** 看板备份的完整性校验，在任何安装或创建之前完成。 */
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { MEDIA_TOTAL_BYTES, type Board, type BoardInstance } from '@dsh-widget-board/contracts'
import { isCardLayout } from '@dsh-widget-board/model'
import { buildDocument, freshNonce } from '../document'
import { contentHash, manifestProblem, type WidgetRecord } from '../library'
import { checkFiles, type BoardPackage, type BoardPackageWidget } from '../package'
import { normalizeWidgetPath } from '../widget-write/write'
import { Refusal } from '../refusal'
import type { RouteContext } from '../routes'
import { instanceOf, stateBytes, withArrangement } from '../state'
import { checkContentBudget, contentIssues, handshakeBytes } from '../content/validate'
import { checkedMedia } from './store'
import { mediaOf } from './routes'

/** base64 必须为规范编码，避免无效字符被 Buffer 静默忽略。 */
export function decodeBase64(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Refusal(400, '包内 base64 不合法')
  return Buffer.from(value, 'base64')
}

export function packageRecord(widget: BoardPackageWidget): WidgetRecord {
  const problem = manifestProblem(widget.manifest)
  if (problem) throw new Refusal(400, problem)
  const files = new Map(Object.entries(widget.files).map(([path, text]) => [normalizeWidgetPath(path), decodeBase64(text)]))
  checkFiles([...files].map(([path, content]) => ({ path, content })))
  if (contentHash(files) !== widget.hash) throw new Refusal(400, '包内组件 hash 不匹配')
  const manifest = files.get('widget.json')
  if (!manifest || JSON.stringify(JSON.parse(manifest.toString('utf8'))) !== JSON.stringify(widget.manifest)) throw new Refusal(400, '包内 manifest 与文件不一致')
  for (const file of ['index.html', 'style.css']) if (!files.has(file)) throw new Refusal(400, `组件缺少 ${file}`)
  // 旧格式没有来源字段；作者域只属于市场，备份不能自行声明可写权限（D30）。
  return { manifest: widget.manifest, files, hash: widget.hash, dir: '', source: widget.manifest.id.includes('.') ? 'market' : 'user' }
}

export async function validateBoardPackage(context: RouteContext, pkg: BoardPackage): Promise<{ records: Map<string, WidgetRecord>, resources: Map<string, Buffer> }> {
  if (pkg.cards.length > 1000 || pkg.widgets.length > 64) throw new Refusal(413, '看板包卡片或组件过多')
  const records = new Map<string, WidgetRecord>()
  for (const widget of pkg.widgets) {
    if (records.has(widget.manifest.id)) throw new Refusal(400, '包内组件 id 重复')
    const record = packageRecord(widget)
    buildDocument(record, context.live.assets, freshNonce(), { lang: 'zh-CN' })
    records.set(record.manifest.id, record)
  }
  const resources = new Map<string, Buffer>()
  if (pkg.media !== undefined && (typeof pkg.media !== 'object' || pkg.media === null || Array.isArray(pkg.media))) throw new Refusal(400, '媒体表不合法')
  if (Object.keys(pkg.media ?? {}).length > 64) throw new Refusal(413, '看板包媒体超过 64 个')
  let total = 0
  for (const [ref, text] of Object.entries(pkg.media ?? {})) {
    if (!/^[0-9a-f]{64}$/.test(ref)) throw new Refusal(400, '媒体路径或 hash 不合法')
    const bytes = decodeBase64(text)
    total += bytes.length
    if (total > MEDIA_TOTAL_BYTES || bytes.length > 2 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== ref) throw new Refusal(400, '媒体 hash 或体积不合法')
    try {
      const metadata = await sharp(bytes, { animated: true, limitInputPixels: 1600 * 1600, failOn: 'warning' }).metadata()
      if (metadata.format !== 'webp' || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > 1600 || metadata.exif || metadata.icc || metadata.xmp || metadata.iptc) throw new Error('必须是去元数据的静态 WebP')
      await sharp(bytes, { failOn: 'warning', limitInputPixels: 1600 * 1600 }).raw().toBuffer()
    } catch (error) { throw new Refusal(400, `包内图片不合法：${(error as Error).message}`) }
    resources.set(ref, bytes)
  }
  let states = 0
  const used = new Set<string>()
  const ids = new Set<string>()
  for (const card of pkg.cards) {
    const record = records.get(card.widget)
    if (!record) throw new Refusal(400, '卡片引用的组件没有包含在包内')
    if (!isCardLayout(card.layout)) throw new Refusal(400, '卡片布局不合法')
    if (card.id !== undefined) { if (typeof card.id !== 'string' || ids.has(card.id)) throw new Refusal(400, '卡片 id 重复或不合法'); ids.add(card.id) }
    contentIssues('props', record.manifest.props, card.props)
    if (card.data !== undefined && card.data !== null) contentIssues('data', record.manifest.data, card.data)
    if (card.state !== undefined && card.state !== null) contentIssues('state', record.manifest.state, card.state)
    checkContentBudget(card.state ?? null, { requestBytes: 0, requestLimit: 1, otherStateBytes: states, handshakeBytes: handshakeBytes(record.manifest, card) })
    states += stateBytes(card.state ?? null)
    for (const [role, ref] of Object.entries(card.media === undefined ? {} : checkedMedia(card.media))) {
      const bytes = resources.get(ref)
      if (!bytes) throw new Refusal(400, '卡片引用的媒体没有包含在包内')
      if (role === 'icon') {
        const meta = await sharp(bytes).metadata()
        if (bytes.length > 128 * 1024 || Math.max(meta.width ?? 0, meta.height ?? 0) > 256) throw new Refusal(400, '图标超过额度')
      }
      used.add(ref)
    }
  }
  if (resources.size !== used.size) throw new Refusal(400, '包内含未引用媒体')
  validateGroups(pkg)
  return { records, resources }
}

function validateGroups(pkg: BoardPackage): void {
  const cardIds = new Set(pkg.cards.map(card => card.id).filter(id => id !== undefined))
  const groups = new Map<string, Array<NonNullable<BoardPackage['cards'][number]['group']>>>()
  for (const card of pkg.cards) {
    if (!card.group) continue
    if (typeof card.group.id !== 'string' || !['front', 'back'].includes(card.group.side) || card.group.template !== 'flip') throw new Refusal(400, '组卡标记不合法')
    if (cardIds.has(card.group.id)) throw new Refusal(400, '组 id 与实例 id 冲突')
    groups.set(card.group.id, [...(groups.get(card.group.id) ?? []), card.group])
  }
  for (const members of groups.values()) if (members.length !== 2 || members[0]?.side === members[1]?.side) throw new Refusal(400, '组卡必须包含正反两面')
  const arrangement = pkg.arrangement
  if (!arrangement) return
  if (arrangement.mode !== 'free' && arrangement.mode !== 'aligned') throw new Refusal(400, '排列模式不合法')
  if (arrangement.mode === 'aligned' || arrangement.aligned !== undefined) {
    const units = new Set(pkg.cards.filter(card => card.group === undefined || card.group.side === 'front').map(card => card.id))
    const aligned = arrangement.aligned
    if (units.has(undefined) || !aligned || !Array.isArray(aligned.order) || new Set(aligned.order).size !== units.size || aligned.order.length !== units.size || aligned.order.some(id => !units.has(id)) || typeof aligned.boxes !== 'object' || aligned.boxes === null || Array.isArray(aligned.boxes) || Object.keys(aligned.boxes).length !== units.size) throw new Refusal(400, '排列引用不完整')
    for (const id of aligned.order) {
      const box = aligned.boxes[id]
      if (!box || !isCardLayout({ x: 0, y: 0, ...box })) throw new Refusal(400, '排列盒子不合法')
    }
  }
}

/** 已校验卡片一次生成；实例、组与排列引用共同换新 id。 */
export function boardFromPackage(board: Board, pkg: BoardPackage, records: ReadonlyMap<string, WidgetRecord>): Board {
  const ids = new Map<string, string>()
  const instances: BoardInstance[] = []
  for (const card of pkg.cards) {
    const base = instanceOf(records.get(card.widget) as WidgetRecord, instances, { props: card.props, layout: card.layout })
    if (card.id) ids.set(card.id, base.id)
    if (card.group && !ids.has(card.group.id)) ids.set(card.group.id, randomUUID())
    instances.push({ ...base, data: card.data ?? null, state: card.state ?? null, ...(card.media ? { media: card.media } : {}), ...(card.group ? { group: { ...card.group, id: ids.get(card.group.id) as string } } : {}) })
  }
  const arrangement = pkg.arrangement?.aligned !== undefined ? {
    mode: pkg.arrangement.mode, aligned: {
      order: pkg.arrangement.aligned!.order.map(id => ids.get(id) as string),
      boxes: Object.fromEntries(Object.entries(pkg.arrangement.aligned!.boxes).map(([id, box]) => [ids.get(id) as string, box])),
    },
  } : pkg.arrangement
  return withArrangement({ ...board, instances, ...(arrangement ? { arrangement } : {}) }).board
}

export async function exportedMedia(context: RouteContext, board: Board): Promise<Record<string, string>> {
  const refs = new Set(board.instances.flatMap(instance => Object.values(instance.media ?? {})))
  const resources: Record<string, string> = {}
  let total = 0
  if (refs.size > 64) throw new Refusal(413, '媒体超过 64 个')
  for (const ref of refs) {
    const bytes = await mediaOf(context).bytes(ref)
    total += bytes.length
    if (total > MEDIA_TOTAL_BYTES) throw new Refusal(413, '媒体超过 16MiB')
    resources[ref] = bytes.toString('base64')
  }
  return resources
}
