import { useEffect, useRef } from 'react'
import { useI18n } from '../lib/i18n'
import { Icon } from './Icon'

export interface ToastItem {
  id: number
  message: string
  tone: 'success' | 'info' | 'error'
}

export function ToastHost({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: number) => void
}) {
  const { tr } = useI18n()
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = hostRef.current as (HTMLDivElement & {
      showPopover?: () => void
      hidePopover?: () => void
    }) | null
    if (!el) return
    try {
      if (toasts.length > 0 && typeof el.showPopover === 'function') {
        if (!el.matches(':popover-open')) el.showPopover()
      } else if (toasts.length === 0 && typeof el.hidePopover === 'function') {
        if (el.matches(':popover-open')) el.hidePopover()
      }
    } catch {
      // Fallback gracefully when Popover API is unavailable.
    }
  }, [toasts.length])

  return (
    <div
      ref={hostRef}
      popover="manual"
      className={`toast-host ${toasts.length > 0 ? 'has-toasts' : ''}`}
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-pill toast-${toast.tone}`} role="status">
          <span className="toast-icon" aria-hidden="true">
            <Icon
              name={toast.tone === 'success' ? 'check' : toast.tone === 'error' ? 'close' : 'spark'}
              size={15}
            />
          </span>
          <span className="toast-message">{toast.message}</span>
          <button
            type="button"
            className="toast-dismiss"
            data-sound="ui-tap"
            onClick={() => onDismiss(toast.id)}
            aria-label={tr('关闭提示', 'Dismiss notification')}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
