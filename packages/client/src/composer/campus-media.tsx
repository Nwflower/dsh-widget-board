import type { ReactNode } from 'react'
import type { MediaBinding } from '@dsh-widget-board/contracts'
import { ImageField } from './media-field'
const ignorePreview = (): void => {}
export function CampusMedia({ target, value, onChange, disabled, onBusy }: { target: string, value: MediaBinding, onChange: (value: MediaBinding) => void, disabled: boolean, onBusy: (busy: boolean) => void }): ReactNode {
  return <>{(['background', 'icon'] as const).map(role => <ImageField key={role} role={role} target={target} value={value} onChange={onChange} disabled={disabled} onBusy={onBusy} onPreview={ignorePreview} />)}</>
}
