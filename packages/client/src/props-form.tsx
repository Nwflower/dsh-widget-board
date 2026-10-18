/**
 * 卡片设置弹窗的 props 表单（D22）：从 manifest 的 props schema 生成字段，宿主仍是唯一校验者。
 *
 * 字符串、数字、布尔与字符串枚举直接出控件；对象、数组与其他少见写法切到整份 JSON 编辑。表单模式
 * 只改声明过的字段，未声明的键原样保留；保存时宿主用 Ajv 校对，逐字段的错误交回这里显示。
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LocalizedText } from '@dsh-widget-board/contracts'
import { isChinese, t, textOf } from './copy'
import { PropsRejectedError } from './snapshot'
import type { PropsIssue } from './snapshot'

/** 表单里一个字段的种类。 */
export type PropsFieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'complex'

/** 从 schema 里读出来的一个字段。 */
export interface PropsField {
  key: string
  kind: PropsFieldKind
  label: string
  hint?: string
  required: boolean
  enumValues?: string[]
  min?: number
  max?: number
  maxLength?: number
  multiline?: boolean
}

/** 同一个名字在若干内置组件里的说法；manifest 的 text 优先。 */
const COMMON_LABELS: Record<string, LocalizedText> = {
  kicker: { zh: '眉题', en: 'Kicker' },
  title: { zh: '标题', en: 'Title' },
  meta: { zh: '右侧说明', en: 'Meta' },
  kind: { zh: '类型', en: 'Kind' },
  columns: { zh: '列数', en: 'Columns' },
  text: { zh: '正文', en: 'Text' },
  label: { zh: '标签', en: 'Label' },
  frontKicker: { zh: '正面眉题', en: 'Front kicker' },
  frontTitle: { zh: '正面标题', en: 'Front title' },
  frontText: { zh: '正面正文', en: 'Front text' },
  backKicker: { zh: '背面眉题', en: 'Back kicker' },
  backTitle: { zh: '背面标题', en: 'Back title' },
  backText: { zh: '背面正文', en: 'Back text' },
}

/** 一个普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 字段名的兜底说法：camelCase 拆成词，首字母大写。
 *
 * @param key - schema 里的字段名。
 * @returns 可显示的名字。
 */
export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (first) => first.toUpperCase())
}

/**
 * 取一个字段的标签：manifest 的 `props.<key>.label` 或 `props.<key>`，再退到 schema 的 title 与
 * 字段名。
 *
 * @param key - 字段名。
 * @param schema - 这个字段的 JSON Schema。
 * @param text - 组件的双语文案。
 * @returns 当前语言下的标签。
 */
function labelOf(key: string, schema: Record<string, unknown>, text: Readonly<Record<string, LocalizedText>> | undefined): string {
  const fromText = text?.[`props.${key}.label`] ?? text?.[`props.${key}`]
  if (fromText !== undefined) return textOf(fromText)
  if (typeof schema.title === 'string' && schema.title.trim() !== '') return schema.title
  const common = COMMON_LABELS[key]
  if (common !== undefined) return textOf(common)
  return humanizeKey(key)
}

/**
 * 取一个字段的说明：manifest 的 `props.<key>.hint`，再退到 schema 的 description。
 *
 * @param key - 字段名。
 * @param schema - 这个字段的 JSON Schema。
 * @param text - 组件的双语文案。
 * @returns 说明，没有时是 `undefined`。
 */
function hintOf(key: string, schema: Record<string, unknown>, text: Readonly<Record<string, LocalizedText>> | undefined): string | undefined {
  const fromText = text?.[`props.${key}.hint`]
  if (fromText !== undefined) return textOf(fromText)
  return typeof schema.description === 'string' && schema.description.trim() !== '' ? schema.description : undefined
}

/**
 * 一份 props schema 里的字段。
 *
 * @param schema - manifest 的 `props`。
 * @param text - 组件的双语文案。
 * @returns 按 schema 里的次序排列的字段；没有 properties 时是空数组。
 */
export function fieldsOf(
  schema: Record<string, unknown> | undefined,
  text: Readonly<Record<string, LocalizedText>> | undefined,
): PropsField[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) return []
  const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : []
  const fields: PropsField[] = []
  for (const [key, raw] of Object.entries(schema.properties)) {
    if (!isRecord(raw)) {
      fields.push({ key, kind: 'complex', label: humanizeKey(key), required: required.includes(key) })
      continue
    }
    const label = labelOf(key, raw, text)
    const hint = hintOf(key, raw, text)
    const isRequired = required.includes(key)
    const enumValues = Array.isArray(raw.enum) && raw.enum.every((value) => typeof value === 'string')
      ? raw.enum as string[]
      : undefined
    if (enumValues !== undefined) {
      fields.push({ key, kind: 'enum', label, ...(hint === undefined ? {} : { hint }), required: isRequired, enumValues })
      continue
    }
    if (raw.type === 'boolean') {
      fields.push({ key, kind: 'boolean', label, ...(hint === undefined ? {} : { hint }), required: isRequired })
      continue
    }
    if (raw.type === 'number' || raw.type === 'integer') {
      fields.push({
        key,
        kind: 'number',
        label,
        ...(hint === undefined ? {} : { hint }),
        required: isRequired,
        ...(typeof raw.minimum === 'number' ? { min: raw.minimum } : {}),
        ...(typeof raw.maximum === 'number' ? { max: raw.maximum } : {}),
      })
      continue
    }
    if (raw.type === 'string') {
      const maxLength = typeof raw.maxLength === 'number' ? raw.maxLength : undefined
      fields.push({
        key,
        kind: 'string',
        label,
        ...(hint === undefined ? {} : { hint }),
        required: isRequired,
        ...(maxLength === undefined ? {} : { maxLength }),
        ...((raw.format === 'textarea' || (maxLength ?? 0) > 200) ? { multiline: true } : {}),
      })
      continue
    }
    fields.push({ key, kind: 'complex', label, ...(hint === undefined ? {} : { hint }), required: isRequired })
  }
  return fields
}

/** 一条字段错误落在哪个字段上。 */
function issueKey(issue: PropsIssue): string | undefined {
  if (!issue.path.startsWith('/')) return undefined
  return issue.path.slice(1).split('/')[0]
}

/** props 表单要画的东西。 */
export interface PropsFormProps {
  /** manifest 的 props schema；没有声明时只显示说明。 */
  schema: Record<string, unknown> | undefined
  /** 组件的双语文案：字段标签与提示从这里取。 */
  text: Record<string, LocalizedText> | undefined
  /** 当前 props。 */
  value: Record<string, unknown>
  /** 别处正在写宿主。 */
  busy: boolean
  /** 保存整份 props；宿主拒绝时抛出 `PropsRejectedError`。 */
  onSave: (props: Record<string, unknown>) => Promise<void>
  /** 有没有未保存的修改，弹窗关闭时据此确认。 */
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * 一张卡的 props 表单：表单与 JSON 两种模式。
 *
 * @param props - schema、当前值、保存回调与忙碌状态。
 * @returns 表单。
 */
export function PropsForm({ schema, text, value, busy, onSave, onDirtyChange }: PropsFormProps): ReactNode {
  const fields = useMemo(() => fieldsOf(schema, text), [schema, text])
  const [draft, setDraft] = useState<Record<string, unknown>>(value)
  const [dirty, setDirty] = useState(false)
  const [jsonMode, setJsonMode] = useState(fields.length === 0)
  const [jsonText, setJsonText] = useState(() => JSON.stringify(value, null, 2))
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [issues, setIssues] = useState<PropsIssue[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // 宿主上的值变了（保存回来、别的页面改了）：没有本地草稿时跟着换。
  useEffect(() => {
    if (dirty) return
    setDraft(value)
    setJsonText(JSON.stringify(value, null, 2))
  }, [dirty, value])

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  /** 把 JSON 文本读成一份 props；读不出来时把原因留在编辑器下面。 */
  const parseJson = (): Record<string, unknown> | undefined => {
    try {
      const parsed: unknown = JSON.parse(jsonText)
      if (!isRecord(parsed)) throw new Error('props 要是一个普通对象')
      setJsonError(null)
      return parsed
    } catch (error) {
      setJsonError(error instanceof SyntaxError ? t('propsJsonInvalid') : (error as Error).message)
      return undefined
    }
  }

  /** 提交一次：表单模式用草稿，JSON 模式先解析。 */
  const save = async (): Promise<void> => {
    if (saving || busy) return
    let payload: Record<string, unknown>
    if (jsonMode) {
      const parsed = parseJson()
      if (parsed === undefined) return
      payload = parsed
    } else {
      payload = draft
    }
    setJsonError(null)
    setIssues([])
    setSaveError(null)
    setSaving(true)
    try {
      await onSave(payload)
      setDirty(false)
    } catch (error) {
      if (error instanceof PropsRejectedError) setIssues(error.issues)
      else setSaveError((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /** 改一个字段：空值表示去掉这个键，让组件用它自己的默认。 */
  const update = (key: string, next: unknown): void => {
    setDraft((previous) => {
      const copy = { ...previous }
      if (next === undefined) delete copy[key]
      else copy[key] = next
      return copy
    })
    setDirty(true)
  }

  /** 恢复默认：写一份空对象，保存后组件用 manifest 里的默认。 */
  const reset = (): void => {
    setDraft({})
    setJsonText('{}')
    setJsonError(null)
    setIssues([])
    setDirty(true)
  }

  if (schema === undefined) {
    return <p className="dsh-widget-board__editor-empty">{t('noProps')}</p>
  }

  return (
    <div className="dsh-widget-board__props" data-dsh-widget-board-props="">
      <div className="dsh-widget-board__editor-toolbar">
        <div className="dsh-widget-board__editor-segment" role="group" aria-label={t('componentSettings')}>
          <button
            type="button"
            aria-pressed={!jsonMode}
            disabled={fields.length === 0}
            onClick={() => {
              if (fields.length === 0) return
              // 切回表单前先把 JSON 读成草稿：否则刚改的内容会在保存时被表单的旧值盖掉。
              const parsed = parseJson()
              if (parsed === undefined) return
              setDraft(parsed)
              setJsonMode(false)
              setDirty(true)
            }}
          >
            {t('propsForm')}
          </button>
          <button
            type="button"
            aria-pressed={jsonMode}
            onClick={() => {
              setJsonMode(true)
              setJsonText(JSON.stringify(draft, null, 2))
              setDirty(true)
            }}
          >
            {t('propsJson')}
          </button>
        </div>
        <span className="dsh-widget-board__editor-spacer" />
        <button type="button" className="dsh-widget-board__editor-ghost" disabled={saving || busy} onClick={reset}>
          {t('reset')}
        </button>
      </div>

      {jsonMode
        ? (
          <label className="dsh-widget-board__field dsh-widget-board__field--wide">
            <span className="dsh-widget-board__field-label">{t('propsJson')}</span>
            <textarea
              className="dsh-widget-board__input dsh-widget-board__textarea"
              spellCheck={false}
              rows={12}
              value={jsonText}
              disabled={saving || busy}
              onChange={(event) => {
                setJsonText(event.target.value)
                setJsonError(null)
                setDirty(true)
              }}
            />
            {jsonError === null ? null : <span className="dsh-widget-board__field-error" role="status">{jsonError}</span>}
          </label>
        )
        : (
          <div className="dsh-widget-board__fields">
            {fields.map((field) => {
              const fieldIssues = issues.filter((issue) => issueKey(issue) === field.key)
              const raw = draft[field.key]
              return (
                <label key={field.key} className="dsh-widget-board__field">
                  <span className="dsh-widget-board__field-label">
                    {field.label}
                    {field.required ? <span className="dsh-widget-board__field-required" aria-hidden="true">*</span> : null}
                  </span>
                  {field.kind === 'enum'
                    ? (
                      <select
                        className="dsh-widget-board__input dsh-widget-board__select"
                        data-dsh-widget-board-field={field.key}
                        value={typeof raw === 'string' ? raw : ''}
                        disabled={saving || busy}
                        onChange={(event) => { update(field.key, event.target.value === '' ? undefined : event.target.value) }}
                      >
                        <option value="">—</option>
                        {(field.enumValues ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    )
                    : field.kind === 'boolean'
                      ? (
                        <select
                          className="dsh-widget-board__input dsh-widget-board__select"
                          data-dsh-widget-board-field={field.key}
                          value={raw === undefined ? '' : raw === true ? 'true' : 'false'}
                          disabled={saving || busy}
                          onChange={(event) => {
                            update(field.key, event.target.value === '' ? undefined : event.target.value === 'true')
                          }}
                        >
                          <option value="">—</option>
                          <option value="true">{isChinese() ? '是' : 'Yes'}</option>
                          <option value="false">{isChinese() ? '否' : 'No'}</option>
                        </select>
                      )
                      : field.kind === 'number'
                        ? (
                          <input
                            className="dsh-widget-board__input"
                            type="number"
                            data-dsh-widget-board-field={field.key}
                            value={typeof raw === 'number' ? String(raw) : ''}
                            min={field.min}
                            max={field.max}
                            step="any"
                            disabled={saving || busy}
                            onChange={(event) => {
                              const next = event.target.value
                              const parsed = Number(next)
                              update(field.key, next === '' || !Number.isFinite(parsed) ? undefined : parsed)
                            }}
                          />
                        )
                        : field.kind === 'string'
                          ? field.multiline
                            ? (
                              <textarea
                                className="dsh-widget-board__input dsh-widget-board__textarea"
                                data-dsh-widget-board-field={field.key}
                                rows={4}
                                maxLength={field.maxLength}
                                value={typeof raw === 'string' ? raw : ''}
                                disabled={saving || busy}
                                onChange={(event) => { update(field.key, event.target.value === '' ? undefined : event.target.value) }}
                              />
                            )
                            : (
                              <input
                                className="dsh-widget-board__input"
                                type="text"
                                data-dsh-widget-board-field={field.key}
                                maxLength={field.maxLength}
                                value={typeof raw === 'string' ? raw : ''}
                                disabled={saving || busy}
                                onChange={(event) => { update(field.key, event.target.value === '' ? undefined : event.target.value) }}
                              />
                            )
                          : (
                            <span className="dsh-widget-board__field-note">
                              {isChinese() ? '这个字段用 JSON 编辑' : 'Edit this field in JSON'}
                            </span>
                          )}
                  {field.hint === undefined ? null : <span className="dsh-widget-board__field-hint">{field.hint}</span>}
                  {fieldIssues.map((issue) => (
                    <span key={`${issue.path}:${issue.message}`} className="dsh-widget-board__field-error" role="status">
                      {issue.message}
                    </span>
                  ))}
                </label>
              )
            })}
          </div>
        )}

      {saveError === null ? null : <p className="dsh-widget-board__editor-error" role="alert">{saveError}</p>}
      {issues.length === 0 || saveError !== null
        ? null
        : <p className="dsh-widget-board__editor-error" role="alert">{issues.map((issue) => `${issue.path} ${issue.message}`).join('；')}</p>}

      <div className="dsh-widget-board__editor-actions">
        <button
          type="button"
          className="dsh-widget-board__editor-primary"
          data-dsh-widget-board-props-save=""
          disabled={saving || busy || !dirty}
          onClick={() => { void save() }}
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  )
}
