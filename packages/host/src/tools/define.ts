/**
 * `widget_define`：新建或更新一个组件类型（D9、D7）。
 *
 * 组件写进用户来源的目录（`$DSH_HOME/widget-board/widgets/<id>/`），写完重读组件库一次。目录里的
 * 每一份文件都要经一次校验：路径不许越出组件目录，manifest 按 `contracts` 里的 JSON Schema 校验，
 * `index.html` 与 `style.css` 必须给。不合格的写入不落地。
 */
import { join } from 'node:path'
import Ajv from 'ajv'
import { strToU8 } from 'fflate'
import type { DefineValue, WidgetManifest, WidgetToolSpec } from '@dsh-widget-board/contracts'
import { WIDGET_MANIFEST_SCHEMA, WIDGET_TOOL_NAMES, ToolRefusal } from '@dsh-widget-board/contracts'
import { writeWidgetDirectory } from '../library'
import type { ToolContext } from './index'

/** manifest 的校验器：与读组件库时用的是同一份 schema（D7）。 */
const ajv = new Ajv({ allErrors: true, strict: true })
const validateManifest = ajv.compile(WIDGET_MANIFEST_SCHEMA)

/** 组件 id 的形状。 */
const ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/

/** 一份文件：相对路径与内容。 */
interface FileInput {
  path: string
  content: string
}

/** 一个参数是不是普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 读一份文件表：路径要在组件目录之内，内容要是字符串。
 *
 * @param value - 模型给的 files。
 * @returns 文件表。
 * @throws {ToolRefusal} 路径越界或内容不是字符串。
 */
function filesOf(value: unknown): FileInput[] {
  if (value === undefined) return []
  if (!isRecord(value)) throw new ToolRefusal('files 要是「相对路径 → 文件内容」的对象')
  const files: FileInput[] = []
  for (const [path, content] of Object.entries(value)) {
    if (typeof content !== 'string') throw new ToolRefusal(`files["${path}"] 的内容要是字符串`)
    // 只允许组件目录之内的相对路径：越出目录、绝对路径、或回到上一层都拒绝（D3）。
    const normalized = path.replaceAll('\\', '/')
    if (normalized === '' || normalized.startsWith('/') || normalized.split('/').includes('..') || /^[a-zA-Z]:/.test(normalized)) {
      throw new ToolRefusal(`files 里的路径要留在组件目录之内：${path}`)
    }
    files.push({ path: normalized, content })
  }
  return files
}

/**
 * 校验 manifest 并给出可读的原因。
 *
 * @param value - 模型给的 manifest。
 * @returns 校验过的 manifest。
 * @throws {ToolRefusal} 不合格。
 */
function manifestOf(value: unknown): WidgetManifest {
  if (!isRecord(value)) throw new ToolRefusal('manifest 要是一个对象')
  if (!validateManifest(value)) {
    const reasons = (validateManifest.errors ?? []).map((error) => `${error.instancePath === '' ? '/' : error.instancePath} ${error.message ?? ''}`.trim())
    throw new ToolRefusal(`manifest 不合格：${reasons.join('；')}`)
  }
  return value as unknown as WidgetManifest
}

/**
 * `widget_define`：写下或覆盖一个组件类型。
 *
 * @param context - 工具要动的那些东西。
 * @returns 工具的注册项。
 */
export function defineTool(context: ToolContext): WidgetToolSpec {
  return {
    name: WIDGET_TOOL_NAMES.define,
    description: 'Create or replace a widget type. Writes the files into the user widget directory, validates the manifest, and reloads the library. Requires index.html and style.css; pass the whole widget each time because a replace rewrites the directory. Load the widget-authoring skill first for the format.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'manifest', 'files'],
      properties: {
        id: { type: 'string', description: 'Widget id, ^[a-z][a-z0-9-]{1,39}$.' },
        manifest: { type: 'object', description: 'The widget.json contents.' },
        files: {
          type: 'object',
          description: 'Relative path to file text. index.html and style.css are required; main.js, samples.json and assets/... are optional.',
        },
        replace: { type: 'boolean', description: 'Allow overwriting an existing widget directory. Without it, an existing id is refused.' },
      },
    },
    async execute(args) {
      if (!isRecord(args) || typeof args.id !== 'string') throw new ToolRefusal('widget_define 要写明 id')
      const wanted = args as { id: string, manifest?: unknown, files?: unknown, replace?: unknown }
      if (!ID_PATTERN.test(wanted.id)) throw new ToolRefusal(`组件 id 要匹配 ^[a-z][a-z0-9-]{1,39}$：${wanted.id}`)
      const manifest = manifestOf(wanted.manifest)
      if (manifest.id !== wanted.id) throw new ToolRefusal(`manifest.id 是 ${manifest.id}，与 id ${wanted.id} 不一致`)
      const files = filesOf(wanted.files)
      for (const required of ['index.html', 'style.css']) {
        if (!files.some((file) => file.path === required)) throw new ToolRefusal(`缺少必需的 ${required}（D7）`)
      }

      const root = context.route.roots.find((candidate) => candidate.source === 'user')
      if (root === undefined) throw new ToolRefusal('没有可写的用户组件目录')
      const dir = join(root.dir, wanted.id)
      const replaced = context.route.records.has(wanted.id)
      if (replaced && wanted.replace !== true) {
        throw new ToolRefusal(`${wanted.id} 已经在组件库里；要覆盖它就带上 replace: true，要另写一个就换一个 id`)
      }
      const notes: string[] = []
      await writeWidgetDirectory(dir, [
        { path: 'widget.json', content: strToU8(`${JSON.stringify(manifest, null, 2)}\n`) },
        ...files.map((file) => ({ path: file.path, content: strToU8(file.content) })),
      ])
      await context.reload()
      const record = context.route.records.get(wanted.id)
      if (record === undefined) throw new ToolRefusal(`写完了，但组件库重读之后没有 ${wanted.id}；检查目录里的文件`)
      notes.push(`写下了 ${files.length + 1} 份文件：widget.json、${files.map((file) => file.path).join('、')}`)
      if (replaced) notes.push('覆盖了同名的组件目录，旧版本仍留在版本库里')
      return { id: record.manifest.id, dir: record.dir, hash: record.hash, replaced, notes } satisfies DefineValue
    },
    render(value) {
      const defined = value as DefineValue
      return [{
        type: 'text',
        text: [
          `${defined.replaced ? '更新' : '新建'}了组件 ${defined.id}，版本哈希 ${defined.hash.slice(0, 12)}。`,
          ...defined.notes,
          `用 ${WIDGET_TOOL_NAMES.place} 把它放到看板上。`,
        ].join('\n'),
      }]
    },
  }
}
