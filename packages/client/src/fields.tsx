/**
 * 卡片设置弹窗的配置一节（D27）：组件声明的每一项各占一行，值不是明文的那些与它们排在一起。
 *
 * 字段从 manifest 的 props schema 读：字符串、数值、布尔与字符串枚举各出对应的控件，其余的写法
 * 只说明要用 JSON 工具写。组件声明的凭据混在同一张表里，输入的值只往宿主的凭据服务走，界面上只
 * 看得到状态。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CardSettings, CredentialSetting, CredentialStatus, LocalizedText } from '@dsh-widget-board/contracts'
import { isChinese, t, textOf } from './copy'
import { geocodeCity, locateCity } from './geocode'
import type { CityFix } from './geocode'
import { PropsRejectedError } from './snapshot'
import type { PropsIssue } from './snapshot'

/** 一行字段的种类。 */
export type ConfigFieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'complex'

/**
 * 一个城市字段解析出来的值分别写到哪几个 props。
 *
 * 写在 schema 的 `fills` 里：`place` 是双语地名，`latitude` 与 `longitude` 是坐标。
 */
export interface CityFills {
  place?: string
  latitude?: string
  longitude?: string
}

/** 从 schema 里读出来的一个字段。 */
export interface ConfigField {
  key: string
  kind: ConfigFieldKind
  label: string
  hint?: string
  required: boolean
  enumValues?: string[]
  min?: number
  max?: number
  maxLength?: number
  multiline?: boolean
  /** schema 里写的默认值：卡片没写这个字段时，控件把它当提示显示。 */
  defaultValue?: unknown
  /** `format: "city"`：这个字段是一个城市名，可以按当前位置填上。 */
  locate?: boolean
  /** 解析出的地名与坐标写到哪里；省略时只把规范化后的名字写回这个字段。 */
  fills?: CityFills
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
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (first) => first.toUpperCase())
}

/**
 * 取一个字段的名字：manifest 的 `props.<key>.label` 或 `props.<key>`，再退到字段名。
 *
 * @param key - 字段名。
 * @param text - 组件的双语文案。
 * @returns 当前语言下的名字。
 */
function labelOf(key: string, text: Readonly<Record<string, LocalizedText>> | undefined): string {
  const fromText = text?.[`props.${key}.label`] ?? text?.[`props.${key}`]
  return fromText === undefined ? humanizeKey(key) : textOf(fromText)
}

/**
 * 取一个字段的说明：manifest 的 `props.<key>.hint`。
 *
 * @param key - 字段名。
 * @param text - 组件的双语文案。
 * @returns 说明，没有时是 `undefined`。
 */
function hintOf(key: string, text: Readonly<Record<string, LocalizedText>> | undefined): string | undefined {
  const fromText = text?.[`props.${key}.hint`]
  return fromText === undefined ? undefined : textOf(fromText)
}

/**
 * 一个城市字段的 `fills`：解析出的地名与坐标各写到哪个 prop。
 *
 * @param value - schema 里的 `fills`。
 * @returns 认得出的那几项；一项都没有时是 `undefined`。
 */
function cityFillsOf(value: unknown): CityFills | undefined {
  if (!isRecord(value)) return undefined
  const fills: CityFills = {}
  for (const key of ['place', 'latitude', 'longitude'] as const) {
    const target = value[key]
    if (typeof target === 'string' && target !== '') fills[key] = target
  }
  return Object.keys(fills).length === 0 ? undefined : fills
}

/**
 * 一份 props schema 里的字段，按声明的次序。
 *
 * @param schema - manifest 的 `props`。
 * @param text - 组件的双语文案。
 * @returns 字段表；没有 properties 时是空表。
 */
export function fieldsOf(
  schema: Record<string, unknown> | undefined,
  text: Readonly<Record<string, LocalizedText>> | undefined,
): ConfigField[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) return []
  const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : []
  const fields: ConfigField[] = []
  for (const [key, raw] of Object.entries(schema.properties)) {
    const label = labelOf(key, text)
    const hint = hintOf(key, text)
    const isRequired = required.includes(key)
    const fallback = isRecord(raw) && raw.default !== undefined ? { defaultValue: raw.default } : {}
    if (!isRecord(raw)) {
      fields.push({ key, kind: 'complex', label, ...(hint === undefined ? {} : { hint }), required: isRequired })
      continue
    }
    // `format: "hidden"` 的字段不出控件：它们由设置界面或工具写（例如城市解析出的坐标），
    // 不让人直接改，免得它和城市名各说各的。
    if (raw.format === 'hidden') continue
    const enumValues = Array.isArray(raw.enum) && raw.enum.every((value) => typeof value === 'string')
      ? raw.enum as string[]
      : undefined
    if (enumValues !== undefined) {
      fields.push({ key, kind: 'enum', label, ...(hint === undefined ? {} : { hint }), required: isRequired, enumValues, ...fallback })
      continue
    }
    if (raw.type === 'boolean') {
      fields.push({ key, kind: 'boolean', label, ...(hint === undefined ? {} : { hint }), required: isRequired, ...fallback })
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
        ...fallback,
      })
      continue
    }
    if (raw.type === 'string') {
      const maxLength = typeof raw.maxLength === 'number' ? raw.maxLength : undefined
      const fills = raw.format === 'city' ? cityFillsOf(raw.fills) : undefined
      fields.push({
        key,
        kind: 'string',
        label,
        ...(hint === undefined ? {} : { hint }),
        required: isRequired,
        ...(maxLength === undefined ? {} : { maxLength }),
        ...((raw.format === 'textarea' || (maxLength ?? 0) > 200) ? { multiline: true } : {}),
        ...(raw.format === 'city' ? { locate: true } : {}),
        ...(fills === undefined ? {} : { fills }),
        ...fallback,
      })
      continue
    }
    fields.push({ key, kind: 'complex', label, ...(hint === undefined ? {} : { hint }), required: isRequired })
  }
  return fields
}

/**
 * 一项凭据的来源说明。
 *
 * @param source - 宿主凭据服务给的来源层 id。
 * @returns 当前语言下的说法。
 */
function sourceText(source: string): string {
  if (source === 'env') return t('credentialEnv')
  if (source === 'file') return t('credentialFile')
  if (source === 'project-env' || source === 'user-env') return t('credentialDotenv')
  return `${t('credentialConfigured')} · ${source}`
}

/**
 * 一项凭据在一行里的状态文字。
 *
 * @param entry - 那一项声明与它的当前状态。
 * @returns 状态文字。
 */
export function credentialStatusOf(entry: CredentialSetting): string {
  const info = entry.info
  if (entry.unavailable !== undefined) return entry.unavailable
  if (info === undefined) return t('credentialMissing')
  if (info.configured !== true) return t('credentialMissing')
  return info.source === undefined ? t('credentialConfigured') : sourceText(info.source)
}

/**
 * 一项凭据的值能不能在这里写。
 *
 * @param entry - 那一项声明与它的当前状态。
 * @returns 能写时为真。
 */
function credentialWritable(entry: CredentialSetting): boolean {
  return entry.info?.writable === true && entry.unavailable === undefined
}

/** 一条字段错误落在哪个字段上。 */
function issueKey(issue: PropsIssue): string | undefined {
  if (!issue.path.startsWith('/')) return undefined
  return issue.path.slice(1).split('/')[0]
}

/** 配置一节要画的东西。 */
export interface ConfigPanelProps {
  settings: CardSettings
  busy: boolean
  /** 保存整份 props；宿主拒绝时抛出 `PropsRejectedError`。 */
  onSaveProps: (props: Record<string, unknown>) => Promise<void>
  /** 写一项凭据；值只往宿主走。 */
  onSetCredential: (ref: string, value: string) => Promise<void>
  /** 移除一项凭据。 */
  onUnsetCredential: (ref: string) => Promise<void>
  /** 有没有未保存的修改，弹窗关闭时据此确认。 */
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * 配置一节：字段与凭据排成一张表，一个「保存」把所有改动交上去。
 *
 * @param props - 设置读模型、写入回调与忙碌状态。
 * @returns 配置一节。
 */
export function ConfigPanel({
  settings,
  busy,
  onSaveProps,
  onSetCredential,
  onUnsetCredential,
  onDirtyChange,
}: ConfigPanelProps): ReactNode {
  const fields = useMemo(() => fieldsOf(settings.widget.propsSchema, settings.widget.text), [settings.widget])
  const [draft, setDraft] = useState<Record<string, unknown>>(settings.instance.props)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [issues, setIssues] = useState<PropsIssue[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [locating, setLocating] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  /** 上一次定位或查城市解析出的结果：保存时同一个名字不必再查一遍。 */
  const resolved = useRef<{ city: string, fix: CityFix } | null>(null)

  // 宿主上的值变了（保存回来、别的页面改了）：清空草稿，跟着宿主走。
  useEffect(() => {
    setDraft(settings.instance.props)
  }, [settings.instance.props])

  const propsDirty = JSON.stringify(draft) !== JSON.stringify(settings.instance.props)
  const secretsDirty = Object.values(secrets).some((value) => value !== '')
  const dirty = propsDirty || secretsDirty

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    if (!dirty) setSaved(false)
  }, [dirty])

  /** 改一个字段：空值表示去掉这个键，让组件用它自己的默认。 */
  const update = (key: string, next: unknown): void => {
    setDraft((previous) => {
      const copy = { ...previous }
      if (next === undefined) delete copy[key]
      else copy[key] = next
      return copy
    })
    setSaved(false)
  }

  /** 把解析好的城市写进草稿：名字回到它自己的字段，地名与坐标按 `fills` 写到别的字段上。 */
  const applyFix = (field: ConfigField, fix: CityFix): void => {
    setDraft((previous) => {
      const copy = { ...previous, [field.key]: fix.city }
      if (field.fills?.place !== undefined) copy[field.fills.place] = fix.place
      if (field.fills?.latitude !== undefined) copy[field.fills.latitude] = fix.latitude
      if (field.fills?.longitude !== undefined) copy[field.fills.longitude] = fix.longitude
      return copy
    })
    resolved.current = { city: fix.city, fix }
    setSaved(false)
  }

  /** 按当前位置给一个城市字段填上名字与坐标。 */
  const locate = async (field: ConfigField): Promise<void> => {
    if (locating !== null || saving || busy) return
    setError(null)
    setLocating(field.key)
    try {
      applyFix(field, await locateCity())
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLocating(null)
    }
  }

  /** 保存：先把 props 交上去，再把填了值的凭据逐项写进宿主的凭据服务。 */
  const save = async (): Promise<void> => {
    if (saving || busy || !dirty) return
    setIssues([])
    setError(null)
    setSaving(true)
    try {
      let next = draft
      // 城市名改过、或地名与坐标还没填上时，先解析成坐标；解析不出来就不保存，免得城市名与
      // 天气各说各的。
      for (const field of fields) {
        if (field.locate !== true) continue
        const value = typeof draft[field.key] === 'string' ? (draft[field.key] as string).trim() : ''
        const previous = typeof settings.instance.props[field.key] === 'string' ? (settings.instance.props[field.key] as string).trim() : ''
        // 清空城市名：连带清掉上一次解析出的地名与坐标，卡片回到自己的默认地点。
        if (value === '') {
          if (previous === '') continue
          next = { ...next }
          delete next[field.key]
          for (const target of [field.fills?.place, field.fills?.latitude, field.fills?.longitude]) {
            if (target !== undefined) delete next[target]
          }
          continue
        }
        const missing = (field.fills?.latitude !== undefined && typeof next[field.fills.latitude] !== 'number')
          || (field.fills?.longitude !== undefined && typeof next[field.fills.longitude] !== 'number')
        if (value === previous && !missing) continue
        const fix = resolved.current !== null && resolved.current.city === value ? resolved.current.fix : await geocodeCity(value)
        next = { ...next, [field.key]: fix.city }
        if (field.fills?.place !== undefined) next[field.fills.place] = fix.place
        if (field.fills?.latitude !== undefined) next[field.fills.latitude] = fix.latitude
        if (field.fills?.longitude !== undefined) next[field.fills.longitude] = fix.longitude
        resolved.current = { city: fix.city, fix }
      }
      if (propsDirty || next !== draft) await onSaveProps(next)
      for (const [ref, value] of Object.entries(secrets)) {
        if (value === '') continue
        await onSetCredential(ref, value)
      }
      setSecrets({})
      setSaved(true)
    } catch (caught) {
      if (caught instanceof PropsRejectedError) setIssues(caught.issues)
      else setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /** 移除一项凭据；第一次按下只把按钮换成确认。 */
  const remove = async (entry: CredentialSetting): Promise<void> => {
    if (confirmRemove !== entry.ref) {
      setConfirmRemove(entry.ref)
      return
    }
    setConfirmRemove(null)
    setError(null)
    setSaving(true)
    try {
      await onUnsetCredential(entry.ref)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (fields.length === 0 && settings.credentials.length === 0) {
    return <p className="dsh-widget-board__editor-empty">{t('noConfig')}</p>
  }

  return (
    <div className="dsh-widget-board__config" data-dsh-widget-board-config="">
      {fields.map((field) => {
        const fieldIssues = issues.filter((issue) => issueKey(issue) === field.key)
        const raw = draft[field.key]
        return (
          <div key={field.key} className="dsh-widget-board__row" data-dsh-widget-board-field-row={field.key}>
            <div className="dsh-widget-board__row-copy">
              <span className="dsh-widget-board__row-title">
                {field.label}
                {field.required ? <span className="dsh-widget-board__field-required" aria-hidden="true">*</span> : null}
              </span>
              {field.hint === undefined ? null : <span className="dsh-widget-board__row-desc">{field.hint}</span>}
              {fieldIssues.map((issue) => (
                <span key={`${issue.path}:${issue.message}`} className="dsh-widget-board__field-error" role="status">
                  {issue.message}
                </span>
              ))}
            </div>
            <div className="dsh-widget-board__row-control">
              {field.kind === 'enum'
                ? (
                  <select
                    className="dsh-widget-board__input dsh-widget-board__select"
                    data-dsh-widget-board-field={field.key}
                    value={typeof raw === 'string' ? raw : (typeof field.defaultValue === 'string' ? field.defaultValue : '')}
                    disabled={saving || busy}
                    onChange={(event) => { update(field.key, event.target.value === '' ? undefined : event.target.value) }}
                  >
                    <option value="">—</option>
                    {(field.enumValues ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                )
                : field.kind === 'boolean'
                  ? (() => {
                    const checked = raw === undefined ? field.defaultValue === true : raw === true
                    return (
                      <button
                        type="button"
                        className="dsh-widget-board__switch"
                        role="switch"
                        aria-checked={checked}
                        aria-label={field.label}
                        data-dsh-widget-board-field={field.key}
                        disabled={saving || busy}
                        onClick={() => { update(field.key, !checked) }}
                      >
                        <span className="dsh-widget-board__switch-thumb" />
                      </button>
                    )
                  })()
                  : field.kind === 'number'
                    ? (
                      <input
                        className="dsh-widget-board__input dsh-widget-board__input--number"
                        type="number"
                        data-dsh-widget-board-field={field.key}
                        value={typeof raw === 'number' ? String(raw) : ''}
                        placeholder={typeof field.defaultValue === 'number' ? String(field.defaultValue) : undefined}
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
                            rows={3}
                            maxLength={field.maxLength}
                            value={typeof raw === 'string' ? raw : ''}
                            disabled={saving || busy}
                            onChange={(event) => { update(field.key, event.target.value === '' ? undefined : event.target.value) }}
                          />
                        )
                        : (
                          <span className={field.locate === true ? 'dsh-widget-board__city' : undefined}>
                            <input
                              className="dsh-widget-board__input"
                              type="text"
                              data-dsh-widget-board-field={field.key}
                              maxLength={field.maxLength}
                              value={typeof raw === 'string' ? raw : ''}
                              placeholder={typeof field.defaultValue === 'string' ? field.defaultValue : undefined}
                              disabled={saving || busy}
                              onChange={(event) => { update(field.key, event.target.value === '' ? undefined : event.target.value) }}
                            />
                            {field.locate === true
                              ? (
                                <button
                                  type="button"
                                  className="dsh-widget-board__editor-ghost dsh-widget-board__locate"
                                  data-dsh-widget-board-locate={field.key}
                                  disabled={saving || busy || locating !== null}
                                  onClick={() => { void locate(field) }}
                                >
                                  {locating === field.key ? t('locating') : t('locate')}
                                </button>
                              )
                              : null}
                          </span>
                        )
                      : <span className="dsh-widget-board__row-desc">{isChinese() ? '用 JSON 工具写' : 'Edit with JSON tools'}</span>}
            </div>
          </div>
        )
      })}

      {settings.credentials.map((entry) => {
        const writable = credentialWritable(entry)
        const configured = entry.info?.configured === true
        const status = credentialStatusOf(entry)
        return (
          <div key={entry.ref} className="dsh-widget-board__row" data-dsh-widget-board-credential={entry.ref}>
            <div className="dsh-widget-board__row-copy">
              <span className="dsh-widget-board__row-title">
                {textOf(entry.label)}
                {entry.required === true ? <span className="dsh-widget-board__field-required" aria-hidden="true">*</span> : null}
              </span>
              <span className="dsh-widget-board__row-ref">{entry.ref}</span>
              {entry.description === undefined ? null : <span className="dsh-widget-board__row-desc">{textOf(entry.description)}</span>}
              <span className="dsh-widget-board__credential-note">{t('credentialPrivacy')}</span>
            </div>
            <div className="dsh-widget-board__row-control dsh-widget-board__row-control--stack">
              <span
                className="dsh-widget-board__credential-status"
                data-configured={configured ? 'true' : 'false'}
                data-writable={writable ? 'true' : 'false'}
              >
                {status}
              </span>
              {writable
                ? (
                  <span className="dsh-widget-board__secret">
                    <input
                      className="dsh-widget-board__input"
                      type="password"
                      data-dsh-widget-board-credential-input={entry.ref}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t('credentialPlaceholder')}
                      value={secrets[entry.ref] ?? ''}
                      disabled={saving || busy}
                      onChange={(event) => {
                        const value = event.target.value
                        setSecrets((previous) => ({ ...previous, [entry.ref]: value }))
                        setSaved(false)
                      }}
                    />
                    {configured
                      ? (
                        <button
                          type="button"
                          className="dsh-widget-board__editor-ghost"
                          disabled={saving || busy}
                          onClick={() => { void remove(entry) }}
                        >
                          {confirmRemove === entry.ref ? t('credentialRemoveConfirm') : t('credentialRemove')}
                        </button>
                      )
                      : null}
                  </span>
                )
                : null}
            </div>
          </div>
        )
      })}

      {error === null ? null : <p className="dsh-widget-board__editor-error" role="alert">{error}</p>}
      {issues.length === 0 || error !== null
        ? null
        : (
          <p className="dsh-widget-board__editor-error" role="alert">
            {issues.map((issue) => `${issue.path} ${issue.message}`).join('；')}
          </p>
        )}

      <div className="dsh-widget-board__editor-actions">
        {saved ? <span className="dsh-widget-board__editor-ok">{t('saved')}</span> : null}
        <span className="dsh-widget-board__editor-spacer" />
        <button
          type="button"
          className="dsh-widget-board__editor-primary"
          data-dsh-widget-board-config-save=""
          disabled={saving || busy || !dirty}
          onClick={() => { void save() }}
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  )
}
