/**
 * `widget_define`：新建或更新一个组件类型（D9、D7）。
 *
 * 组件写进用户来源的目录（`$DSH_HOME/widget-board/widgets/<id>/`），写完重读组件库一次。目录里的
 * 每一份文件都要经一次校验：路径不许越出组件目录，manifest 按 `contracts` 里的 JSON Schema 校验，
 * `index.html` 与 `style.css` 必须给。不合格的写入不落地。
 */
import { join } from 'node:path'
import { strToU8 } from 'fflate'
import type { DefineValue, SelfCheckResult, WidgetManifest, WidgetToolSpec } from '@dsh-widget-board/contracts'
import { PARENT_MESSAGE_LIMIT, WIDGET_TOOL_NAMES, ToolRefusal, selfCheckBoxes, withinLimit } from '@dsh-widget-board/contracts'
import { DEFAULT_HEIGHT_REM, snapCardHeight } from '@dsh-widget-board/model'
import { isRecord } from '../guards'
import { manifestProblem, writeWidgetDirectory } from '../library'
import type { ToolContext } from './index'

/** 组件 id 的形状。 */
const ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/

/** 一份文件：相对路径与内容。 */
interface FileInput {
  path: string
  content: string
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
  const problem = manifestProblem(value)
  if (problem !== undefined) throw new ToolRefusal(problem)
  return value as WidgetManifest
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
        preview: {
          type: 'object',
          additionalProperties: false,
          description: 'Props and data to render the widget with for the self-check and the inline preview. Use realistic content so the check sees the real layout.',
          properties: {
            props: { type: 'object' },
            data: {},
          },
        },
      },
    },
    async execute(args, call) {
      if (!isRecord(args) || typeof args.id !== 'string') throw new ToolRefusal('widget_define 要写明 id')
      const wanted = args as { id: string, manifest?: unknown, files?: unknown, replace?: unknown, preview?: unknown }
      if (!ID_PATTERN.test(wanted.id)) throw new ToolRefusal(`组件 id 要匹配 ^[a-z][a-z0-9-]{1,39}$：${wanted.id}`)
      const manifest = manifestOf(wanted.manifest)
      if (manifest.id !== wanted.id) throw new ToolRefusal(`manifest.id 是 ${manifest.id}，与 id ${wanted.id} 不一致`)
      const files = filesOf(wanted.files)
      // widget.json 只从 manifest 生成：files 里再带一份会按写入顺序盖掉校验过的内容，落盘的就不是
      // 校验过的那份了。
      if (files.some((file) => file.path === 'widget.json')) {
        throw new ToolRefusal('widget.json 由 manifest 参数写成；files 里不要再带一份')
      }
      for (const required of ['index.html', 'style.css']) {
        if (!files.some((file) => file.path === required)) throw new ToolRefusal(`缺少必需的 ${required}（D7）`)
      }
      const preview = previewOf(context, manifest, wanted.preview)

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
      // 自检交给正在显示这次调用的会话页面：它把新版本放进几个代表性的盒子量一遍（D9、D13）。
      const check = await context.route.selfChecks.run(call.callId, {
        widget: record.manifest.id,
        hash: record.hash,
        props: preview.props,
        data: preview.data,
        text: record.manifest.text ?? {},
        boxes: selfCheckBoxes(record.manifest.minBox),
      }, call.signal)
      return {
        id: record.manifest.id,
        dir: record.dir,
        hash: record.hash,
        replaced,
        notes,
        check,
        preview,
        title: record.manifest.title,
        height: snapCardHeight(record.manifest.defaultBox?.h ?? DEFAULT_HEIGHT_REM),
      } satisfies DefineValue
    },
    render(value) {
      const defined = value as DefineValue
      return [{
        type: 'text',
        text: [
          `${defined.replaced ? '更新' : '新建'}了组件 ${defined.id}，版本哈希 ${defined.hash.slice(0, 12)}。`,
          ...defined.notes,
          ...checkLines(defined.check),
          defined.check.status === 'failed'
            ? `先按上面的问题改好，带上 replace: true 再调一次 ${WIDGET_TOOL_NAMES.define}。`
            : `用 ${WIDGET_TOOL_NAMES.place} 把它放到看板上，或用 ${WIDGET_TOOL_NAMES.show} 在会话里给用户看。`,
        ].join('\n'),
      }]
    },
    view(value) {
      return value
    },
  }
}

/**
 * 自检的结论读成给模型的几行。
 *
 * @param check - 自检的结论。
 * @returns 文本行。
 */
function checkLines(check: SelfCheckResult): string[] {
  if (check.status === 'unverified') return [`自检没有做：${check.reason ?? '没有页面交回报告'}。`]
  const boxes = check.boxes.map((box) => `${String(box.box.cols)} 列 × ${String(box.box.h)}rem`).join('、')
  if (check.status === 'passed') return [`自检通过：在 ${boxes} 里排版正常，没有脚本错误。`]
  return [`自检发现问题（量过 ${boxes}）：`, ...check.problems.map((problem) => `- ${problem}`)]
}

/**
 * 读自检与预览用的 props 与 data：形状要符合组件自己的 schema。
 *
 * @param context - 工具要动的那些东西。
 * @param manifest - 校验过的 manifest。
 * @param value - 模型给的 preview。
 * @returns props 与 data。
 * @throws {ToolRefusal} 不符合 schema 或超过桥的长度上限。
 */
function previewOf(context: ToolContext, manifest: WidgetManifest, value: unknown): DefineValue['preview'] {
  if (value === undefined) return { props: {}, data: null }
  if (!isRecord(value)) throw new ToolRefusal('preview 要是 { props, data }')
  if (value.props !== undefined && !isRecord(value.props)) throw new ToolRefusal('preview.props 要是一个对象')
  const props = (value.props ?? {}) as Record<string, unknown>
  const propsProblem = context.propsError(manifest.props, props)
  if (propsProblem !== undefined) throw new ToolRefusal(`preview.props 与 manifest 的 props schema 不符：${propsProblem}`)
  const data = value.data ?? null
  if (value.data !== undefined) {
    const dataProblem = context.dataError(manifest.data, data)
    if (dataProblem !== undefined) throw new ToolRefusal(`preview.data 与 manifest 的 data schema 不符：${dataProblem}`)
  }
  const preview = { props, data }
  // 上限按父页面发给组件的那一档：preview 会整份装进内联显示的 init 消息（D3）。
  if (!withinLimit(preview, PARENT_MESSAGE_LIMIT)) throw new ToolRefusal(`preview 超过 ${String(PARENT_MESSAGE_LIMIT)} 字节；只给能看出排版的那部分`)
  return preview
}
