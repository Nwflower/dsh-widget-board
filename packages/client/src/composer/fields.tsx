/**
 * 嵌套表单（C03、C04）：schema 树画成控件，数组能加、删、上下移动，对象里不支持的写法给一个显式
 * 的 JSON 入口兜底。
 *
 * 数组项的身份不放进值里：值就是卡片真正会存下的那份 JSON，项的身份留在这一层的状态里，重排时按
 * 身份换位置——焦点因此跟着同一项走，而不是跟着序号走。往值里多写一个表单专用的 id 会被组件的
 * schema 拒掉，所以不能写进去。
 */
import { useEffect, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { LocalizedText } from '@dsh-widget-board/contracts'
import { isChinese, t } from '../copy'
import type { SchemaField, SchemaNode } from './schema'
import { fieldsOfTree, hintOf, isRecord, labelOf } from './schema'

/** 一棵表单共用的环境：文案、宿主的逐字段原因、禁用状态与这是哪一节。 */
export interface FormEnv {
  text?: Readonly<Record<string, LocalizedText>>
  /** 键是点分路径，例如 `items.0.text`；与渲染时拼出来的路径对得上。 */
  issues?: Readonly<Record<string, string>>
  disabled?: boolean
  /** 这一份是 props、data 还是 state；字段名字按它去 manifest 的 text 里找。 */
  section?: 'props' | 'data' | 'state'
}

/**
 * 宿主给的 JSON Pointer 到表单路径：`/items/0/text` → `items.0.text`。
 *
 * @param pointer - 宿主逐字段原因里的路径。
 * @returns 表单里的点分路径。
 */
export function formPathOf(pointer: string): string {
  return pointer.replace(/^\//, '').replace(/\//g, '.')
}

/**
 * 表单要写回卡片的那份值：顶层永远是对象。
 *
 * 空字符串与空数组照原样留着——组件可能真的要靠它们表达一种状态，替它删掉就等于改掉它的默认值。
 *
 * @param value - 表单里的值。
 * @returns 写进卡片的那一份。
 */
export function formResult(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

/** 一个字段的外壳：名字、说明、必填标记与错误。 */
function FieldShell({ path, field, env, children }: {
  path: string
  field: SchemaField
  env: FormEnv
  children: ReactNode
}): ReactNode {
  const message = env.issues?.[path]
  const label = labelOf(path, env.text, env.section)
  const hint = hintOf(path, env.text, env.section)
  return (
    <div
      className="dsh-widget-board__field"
      data-dsh-widget-board-field-row={path}
      data-disabled={env.disabled === true ? 'true' : undefined}
    >
      <div className="dsh-widget-board__field-head">
        <span className="dsh-widget-board__field-label">
          {label}
          {field.required ? <span className="dsh-widget-board__field-required" aria-hidden="true">*</span> : null}
        </span>
        {hint === undefined ? null : <span className="dsh-widget-board__field-hint">{hint}</span>}
      </div>
      {children}
      {message === undefined ? null : <span className="dsh-widget-board__field-error" role="status">{message}</span>}
    </div>
  )
}

/** 一项数组新加进来时的初值：对象空、数组空，别的留空由人填。 */
function seedOf(node: SchemaNode): unknown {
  if (node.kind === 'object') return {}
  if (node.kind === 'array') return []
  return undefined
}

/** 一个枚举值在 manifest 里可能写了名字：`props.enum.<值>`。 */
function enumLabel(value: string, text: Readonly<Record<string, LocalizedText>> | undefined): string {
  const fromText = text?.[`props.enum.${value}`]
  if (fromText === undefined) return value
  return isChinese() ? fromText.zh : fromText.en
}

/** 一段 JSON 的编辑入口：不支持表单的写法、超过递归层数、没声明过的键都走这里（C04）。 */
function JsonControl({ value, onChange, reason, env, path }: {
  value: unknown
  onChange: (next: unknown) => void
  reason: string
  env: FormEnv
  path: string
}): ReactNode {
  const text = value === undefined ? '' : JSON.stringify(value, null, 2)
  const [draft, setDraft] = useState(text)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(text)
  // 外部换了值（重新读取、换了一项）：跟着换，别让草稿停在旧内容上。
  useEffect(() => {
    if (seen === text) return
    setSeen(text)
    setDraft(text)
    setError(null)
  }, [seen, text])
  return (
    <div className="dsh-widget-board__json" data-dsh-widget-board-json={path}>
      {open
        ? (
          <textarea
            className="dsh-widget-board__input dsh-widget-board__textarea dsh-widget-board__json-input"
            data-dsh-widget-board-json-input={path}
            rows={4}
            spellCheck={false}
            value={draft}
            disabled={env.disabled === true}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
              const next = event.target.value
              setDraft(next)
              if (next.trim() === '') {
                setError(null)
                onChange(undefined)
                return
              }
              try {
                onChange(JSON.parse(next) as unknown)
                setError(null)
              } catch (caught) {
                setError((caught as Error).message)
              }
            }}
          />
        )
        : <span className="dsh-widget-board__json-preview">{text === '' ? '—' : text.replace(/\s+/g, ' ').slice(0, 120)}</span>}
      {error === null ? null : <span className="dsh-widget-board__field-error" role="status">{`JSON 读不出来：${error}`}</span>}
      <div className="dsh-widget-board__json-foot">
        <span className="dsh-widget-board__field-hint">{reason}</span>
        <button
          type="button"
          className="dsh-widget-board__editor-ghost"
          data-dsh-widget-board-json-toggle={path}
          disabled={env.disabled === true}
          onClick={() => { setOpen(!open) }}
        >
          {open ? t('formJsonClose') : t('formJsonOpen')}
        </button>
      </div>
    </div>
  )
}

/** 一项数组：加在末尾、删掉、上下移动，键序跟着身份走（C03）。 */
function ArrayItems({ node, value, onChange, env, path }: {
  node: Extract<SchemaNode, { kind: 'array' }>
  value: unknown
  onChange: (next: unknown) => void
  env: FormEnv
  path: string
}): ReactNode {
  const items = Array.isArray(value) ? value : []
  const [keys, setKeys] = useState<string[]>(() => items.map((_, index) => `${path}:${String(index)}`))
  const disabled = env.disabled === true
  const limit = node.maxItems ?? Number.POSITIVE_INFINITY

  // 长度变了（加、删、外部换了一份内容）：补齐或截短；身份表只在事件处理与这一处改。
  useEffect(() => {
    setKeys((previous) => {
      const next = items.map((_, index) => previous[index] ?? `${path}:${String(index)}`)
      return next.length === previous.length && next.every((key, index) => key === previous[index]) ? previous : next
    })
  }, [items.length, path])

  const identityAt = (index: number): string => keys[index] ?? `${path}:${String(index)}`
  const write = (next: unknown[]): void => { onChange(next.length === 0 ? undefined : next) }

  const move = (from: number, to: number): void => {
    if (to < 0 || to >= items.length) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    const reordered = [...keys]
    const [identity] = reordered.splice(from, 1)
    if (identity !== undefined) reordered.splice(to, 0, identity)
    setKeys(reordered)
    write(next)
  }

  return (
    <div className="dsh-widget-board__array" data-dsh-widget-board-array={path}>
      {items.map((item, index) => {
        const identity = identityAt(index)
        const itemPath = `${path}.${String(index)}`
        const titled = isRecord(item) && typeof item.title === 'string' && item.title.trim() !== ''
        const heading = titled ? String((item as Record<string, unknown>).title) : `${t('formItem')} ${String(index + 1)}`
        const field: SchemaField = { key: String(index), node: node.item, required: false }
        return (
          <div className="dsh-widget-board__array-item" key={identity} data-dsh-widget-board-item={identity}>
            <div className="dsh-widget-board__array-head">
              <span className="dsh-widget-board__array-index">{heading}</span>
              <span className="dsh-widget-board__array-actions">
                <button
                  type="button"
                  className="dsh-widget-board__icon-button"
                  data-dsh-widget-board-move="up"
                  disabled={disabled || index === 0}
                  aria-label={t('formMoveUp')}
                  title={t('formMoveUp')}
                  onClick={() => { move(index, index - 1) }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="dsh-widget-board__icon-button"
                  data-dsh-widget-board-move="down"
                  disabled={disabled || index === items.length - 1}
                  aria-label={t('formMoveDown')}
                  title={t('formMoveDown')}
                  onClick={() => { move(index, index + 1) }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="dsh-widget-board__icon-button dsh-widget-board__icon-button--danger"
                  data-dsh-widget-board-remove-item=""
                  disabled={disabled}
                  aria-label={t('formRemoveItem')}
                  title={t('formRemoveItem')}
                  onClick={() => {
                    setKeys(keys.filter((_, at) => at !== index))
                    write(items.filter((_, at) => at !== index))
                  }}
                >
                  ×
                </button>
              </span>
            </div>
            <Control
              node={node.item}
              path={itemPath}
              field={field}
              value={item}
              env={env}
              onChange={(next: unknown) => {
                const copy = [...items]
                copy[index] = next
                write(copy)
              }}
            />
          </div>
        )
      })}
      <div className="dsh-widget-board__array-foot">
        <button
          type="button"
          className="dsh-widget-board__editor-ghost"
          data-dsh-widget-board-add-item={path}
          disabled={disabled || items.length >= limit}
          onClick={() => {
            const next = [...items, seedOf(node.item)]
            setKeys([...items.map((_, index) => identityAt(index)), `${path}:add:${String(next.length)}:${String(Date.now())}`])
            write(next)
          }}
        >
          {t('formAddItem')}
        </button>
        {node.maxItems === undefined ? null : (
          <span className="dsh-widget-board__array-count">{`${String(items.length)} / ${String(node.maxItems)}`}</span>
        )}
      </div>
    </div>
  )
}

/** 一个值转成一个控件。 */
function Control({ node, path, field, value, onChange, env }: {
  node: SchemaNode
  path: string
  field: SchemaField
  value: unknown
  onChange: (next: unknown) => void
  env: FormEnv
}): ReactNode {
  const disabled = env.disabled === true
  if (node.kind === 'json') {
    return <JsonControl value={value} onChange={onChange} reason={node.reason} env={env} path={path} />
  }
  if (node.kind === 'boolean') {
    const checked = value === true
    return (
      <button
        type="button"
        className="dsh-widget-board__switch"
        role="switch"
        aria-checked={checked}
        aria-label={labelOf(path, env.text, env.section)}
        data-dsh-widget-board-field={path}
        disabled={disabled}
        onClick={() => { onChange(checked ? undefined : true) }}
      >
        <span className="dsh-widget-board__switch-thumb" />
      </button>
    )
  }
  if (node.kind === 'number') {
    return (
      <input
        className="dsh-widget-board__input dsh-widget-board__input--number"
        type="number"
        inputMode={node.integer ? 'numeric' : 'decimal'}
        step={node.integer ? 1 : 'any'}
        data-dsh-widget-board-field={path}
        value={typeof value === 'number' ? String(value) : ''}
        min={node.min}
        max={node.max}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const raw = event.target.value
          if (raw === '') { onChange(undefined); return }
          const parsed = Number(raw)
          onChange(Number.isFinite(parsed) ? (node.integer ? Math.round(parsed) : parsed) : undefined)
        }}
      />
    )
  }
  if (node.kind === 'enum') {
    return (
      <select
        className="dsh-widget-board__input dsh-widget-board__select"
        data-dsh-widget-board-field={path}
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          const raw = event.target.value
          onChange(raw === '' ? undefined : raw)
        }}
      >
        <option value="">{t('formUnset')}</option>
        {node.values.map((item) => <option key={item} value={item}>{enumLabel(item, env.text)}</option>)}
      </select>
    )
  }
  if (node.kind === 'string') {
    const shown = typeof value === 'string' ? value : ''
    if (node.multiline) {
      return (
        <textarea
          className="dsh-widget-board__input dsh-widget-board__textarea"
          data-dsh-widget-board-field={path}
          rows={3}
          maxLength={node.maxLength}
          value={shown}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { onChange(event.target.value === '' ? undefined : event.target.value) }}
        />
      )
    }
    const type = node.format === 'date' ? 'date' : node.format === 'time' ? 'time' : node.format === 'url' ? 'url' : 'text'
    return (
      <input
        className="dsh-widget-board__input"
        type={type}
        data-dsh-widget-board-field={path}
        maxLength={node.maxLength}
        value={shown}
        disabled={disabled}
        autoComplete="off"
        onChange={(event: ChangeEvent<HTMLInputElement>) => { onChange(event.target.value === '' ? undefined : event.target.value) }}
      />
    )
  }
  if (node.kind === 'object') {
    return (
      <ObjectFields
        fields={node.children}
        {...(node.additional ? { extra: extraKeys(value, node.children) } : {})}
        prefix={path}
        value={value}
        onChange={onChange}
        env={env}
      />
    )
  }
  return <ArrayItems node={node} value={value} onChange={onChange} env={env} path={path} />
}

/**
 * 一份对象里多出来的键：`additionalProperties` 放开时，表单要能看见并保留它们。
 *
 * @param value - 这一层的值。
 * @param fields - schema 里声明过的字段。
 * @returns 没声明过的那几个键。
 */
function extraKeys(value: unknown, fields: readonly SchemaField[]): string[] {
  if (!isRecord(value)) return []
  const known = new Set(fields.map((field) => field.key))
  return Object.keys(value).filter((key) => !known.has(key))
}

/** 一个对象下面的全部字段。 */
function ObjectFields({ fields, extra, value, onChange, env, prefix = '' }: {
  fields: SchemaField[]
  extra?: string[]
  value: unknown
  onChange: (next: unknown) => void
  env: FormEnv
  /** 这一层在整份值里的点分路径；顶层是空串。 */
  prefix?: string
}): ReactNode {
  const record = isRecord(value) ? value : {}
  const write = (key: string, next: unknown): void => {
    const base = isRecord(value) ? { ...value } : {}
    if (next === undefined) delete base[key]
    else base[key] = next
    onChange(base)
  }
  return (
    <div className="dsh-widget-board__fields" data-dsh-widget-board-fields={prefix === '' ? undefined : prefix}>
      {fields.map((field) => {
        const path = prefix === '' ? field.key : `${prefix}.${field.key}`
        return (
          <FieldShell key={field.key} path={path} field={field} env={env}>
            <Control
              node={field.node}
              path={path}
              field={field}
              value={record[field.key] ?? field.defaultValue}
              env={env}
              onChange={(next: unknown) => { write(field.key, next) }}
            />
          </FieldShell>
        )
      })}
      {(extra ?? []).map((key) => {
        const path = prefix === '' ? key : `${prefix}.${key}`
        return (
          <div className="dsh-widget-board__field" key={`extra:${key}`} data-dsh-widget-board-field-row={path} data-extra="true">
            <div className="dsh-widget-board__field-head">
              <span className="dsh-widget-board__field-label">{key}</span>
              <span className="dsh-widget-board__field-hint">{t('formUndeclared')}</span>
            </div>
            <JsonControl
              value={record[key]}
              onChange={(next: unknown) => { write(key, next) }}
              reason={t('formUndeclared')}
              env={env}
              path={path}
            />
          </div>
        )
      })}
    </div>
  )
}

/**
 * 一份值的整张表单：按 schema 里的顶级字段铺开。
 *
 * @param props - schema、值、写入回调、文案、宿主的逐字段原因与禁用状态。
 * @returns 表单。
 */
export function SchemaForm({ schema, value, onChange, text, issues, disabled, section = 'props' }: {
  schema: Record<string, unknown> | undefined
  value: unknown
  onChange: (next: unknown) => void
  text?: Readonly<Record<string, LocalizedText>>
  issues?: Readonly<Record<string, string>>
  disabled?: boolean
  section?: 'props' | 'data' | 'state'
}): ReactNode {
  const fields = fieldsOfTree(schema)
  const env: FormEnv = {
    ...(text === undefined ? {} : { text }),
    ...(issues === undefined ? {} : { issues }),
    ...(disabled === true ? { disabled } : {}),
    section,
  }
  if (fields.length === 0) return <p className="dsh-widget-board__editor-empty">{t('formNoFields')}</p>
  return <ObjectFields fields={fields} value={isRecord(value) ? value : {}} onChange={onChange} env={env} />
}
