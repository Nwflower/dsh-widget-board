import { useRef } from 'react'
import type { ReactNode } from 'react'
import type { MediaBinding, MediaRole } from '@dsh-widget-board/contracts'
import { ImageField } from './media-field'
const ignorePreview = (): void => {}
export function CampusMedia({ target, value, onChange, disabled, onBusy }: { target: string, value: MediaBinding, onChange: (value: MediaBinding, role: MediaRole) => void, disabled: boolean, onBusy: (busy: boolean) => void }): ReactNode {
  /** 两个字段各自上传：忙碌按角色记，任何一个还没完就压住保存。 */
  const busyRoles = useRef(new Set<MediaRole>())
  const report = (role: MediaRole) => (busy: boolean): void => {
    if (busy) busyRoles.current.add(role)
    else busyRoles.current.delete(role)
    onBusy(busyRoles.current.size > 0)
  }
  return <>{(['background', 'icon'] as const).map(role => <ImageField key={role} role={role} target={target} value={value} onChange={onChange} disabled={disabled} onBusy={report(role)} onPreview={ignorePreview} />)}</>
}
