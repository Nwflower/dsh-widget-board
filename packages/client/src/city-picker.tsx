/**
 * 城市字段的选择器：边输边查候选，点一条就把名字、双语地名与坐标一次填好。
 *
 * 从设置表单里拆出来单独一份：表单那一个文件已经到停止线，城市这一块的交互还会再长。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ConfigField } from './fields'
import { fixOfCandidate, suggestCities } from './geocode'
import type { CityCandidate } from './geocode'
import { t } from './copy'

/**
 * 城市字段填好之后写在哪儿：纬度、经度的键名。
 *
 * @param draft - 正在改的 props。
 * @param field - 城市字段。
 * @returns 纬度与经度；没解析过时为 `undefined`。
 */
export function latitudeOf(draft: Record<string, unknown>, field: ConfigField): { latitude: number, longitude: number } | undefined {
  const latitudeKey = field.fills?.latitude
  const longitudeKey = field.fills?.longitude
  if (latitudeKey === undefined || longitudeKey === undefined) return undefined
  const latitude = draft[latitudeKey]
  const longitude = draft[longitudeKey]
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return undefined
  return { latitude, longitude }
}

/** 城市选择器要知道的东西。 */
export interface CityPickerProps {
  field: ConfigField
  /** 输入框里的原文。 */
  value: string
  /** 上一次解析出的双语地名。 */
  resolved?: { zh?: unknown, en?: unknown } | undefined
  /** 上一次解析出的坐标。 */
  coordinates?: { latitude: number, longitude: number } | undefined
  disabled: boolean
  locating: boolean
  /** 输入框原文变化。 */
  onChange: (next: string) => void
  /** 从下拉里选中一条候选。 */
  onPick: (candidate: CityCandidate) => void
  /** 按当前位置解析。 */
  onLocate: () => void
}

/**
 * 城市字段：边打字边查候选，点一条就把名字、双语地名与坐标一次填好。
 *
 * 以前这里是个纯文本框，能填什么全靠猜：名字拼错要等保存才知道。现在候选里带地区与国家，
 * 同名的城市分得开；选中之后行下显示解析出的坐标，随时能「换一座」。
 *
 * @param props - 字段、当前值与回调。
 * @returns 城市选择器。
 */
export function CityPicker({ field, value, resolved, coordinates, disabled, locating, onChange, onPick, onLocate }: CityPickerProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<CityCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(-1)
  /** 选中之后收起输入框，只留一行「已选」的摘要。 */
  const [collapsed, setCollapsed] = useState(resolved !== undefined && value !== '')
  const root = useRef<HTMLSpanElement | null>(null)

  // 输入停下来再查：每敲一个字就发一次请求，既慢又浪费。
  useEffect(() => {
    const query = value.trim()
    if (!open || query.length === 0) {
      setItems([])
      setSearching(false)
      setFailed(false)
      return undefined
    }
    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(() => {
      suggestCities(query)
        .then((found) => {
          if (cancelled) return
          setItems(found)
          setFailed(false)
          setActive(found.length > 0 ? 0 : -1)
        })
        .catch(() => {
          if (cancelled) return
          setItems([])
          setFailed(true)
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 280)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [value, open])

  // 点到外面就收起下拉。
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [open])

  const place = resolved !== undefined && typeof resolved.zh === 'string' ? resolved.zh : ''
  const english = resolved !== undefined && typeof resolved.en === 'string' ? resolved.en : ''
  const summary = place === '' ? '' : english === '' || english === place ? place : `${place} · ${english}`
  const span = coordinates === undefined ? '' : `${coordinates.latitude.toFixed(2)}, ${coordinates.longitude.toFixed(2)}`

  if (collapsed && value !== '') {
    return (
      <span className="dsh-widget-board__city" ref={root} data-dsh-widget-board-city={field.key}>
        <span className="dsh-widget-board__city-picked">
          <span className="dsh-widget-board__city-name">{summary === '' ? value : summary}</span>
          <span className="dsh-widget-board__city-meta">
            {span === '' ? t('cityPicked') : `${t('cityPicked')} · ${span}`}
          </span>
        </span>
        <button
          type="button"
          className="dsh-widget-board__editor-ghost"
          data-dsh-widget-board-city-change={field.key}
          disabled={disabled}
          onClick={() => { setCollapsed(false); setOpen(true) }}
        >
          {t('cityChange')}
        </button>
      </span>
    )
  }

  return (
    <span className="dsh-widget-board__city" ref={root} data-dsh-widget-board-city={field.key}>
      <span className="dsh-widget-board__city-field">
        <input
          className="dsh-widget-board__input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          data-dsh-widget-board-field={field.key}
          maxLength={field.maxLength}
          value={value}
          placeholder={typeof field.defaultValue === 'string' ? field.defaultValue : t('cityHint')}
          disabled={disabled}
          onFocus={() => { setOpen(true) }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
              setActive((index) => Math.min(items.length - 1, index + 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((index) => Math.max(0, index - 1))
            } else if (event.key === 'Enter') {
              const candidate = items[active]
              if (open && candidate !== undefined) {
                event.preventDefault()
                onPick(candidate)
                setOpen(false)
                setCollapsed(true)
              }
            } else if (event.key === 'Escape') {
              setOpen(false)
            }
          }}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
          }}
        />
        <button
          type="button"
          className="dsh-widget-board__editor-ghost dsh-widget-board__locate"
          data-dsh-widget-board-locate={field.key}
          disabled={disabled || locating}
          onClick={onLocate}
        >
          {locating ? t('locating') : t('locate')}
        </button>
      </span>
      {open && value.trim() !== '' && items.length > 0
        ? (
          <span className="dsh-widget-board__city-list" role="listbox" data-dsh-widget-board-city-list={field.key}>
            {items.map((candidate, index) => (
              <button
                key={`${String(candidate.id ?? candidate.latitude)}:${candidate.en}`}
                type="button"
                role="option"
                aria-selected={index === active}
                className="dsh-widget-board__city-option"
                data-active={index === active ? 'true' : 'false'}
                onMouseEnter={() => { setActive(index) }}
                onMouseDown={(event) => { event.preventDefault() }}
                onClick={() => {
                  onPick(candidate)
                  setOpen(false)
                  setCollapsed(true)
                }}
              >
                <span className="dsh-widget-board__city-name">{candidate.zh === candidate.en ? candidate.zh : `${candidate.zh} · ${candidate.en}`}</span>
                <span className="dsh-widget-board__city-meta">
                  {candidate.detail === '' ? `${candidate.latitude.toFixed(2)}, ${candidate.longitude.toFixed(2)}` : candidate.detail}
                </span>
              </button>
            ))}
          </span>
        )
        : null}
      {open && value.trim() !== '' && items.length === 0
        ? (
          <span className="dsh-widget-board__city-tip" role="status">
            {searching ? t('citySearching') : failed ? t('cityLookupFailed') : t('cityNoMatch')}
          </span>
        )
        : null}
    </span>
  )
}
