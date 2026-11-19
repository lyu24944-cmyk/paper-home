import { useEffect, useRef, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n'
import { playSound } from '../lib/sound'
import { Icon } from './Icon'

export function Modal({
  open,
  close,
  label,
  children,
  className = '',
}: {
  open: boolean
  close: () => void
  label: string
  children: ReactNode
  className?: string
}) {
  const { tr } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  const closingProgrammaticallyRef = useRef(false)

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (open && !el.open) {
      closingProgrammaticallyRef.current = false
      el.showModal()
    } else if (!open && el.open) {
      closingProgrammaticallyRef.current = true
      el.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialog}
      className={`paper-dialog ${className}`}
      aria-label={label}
      onClose={() => {
        if (closingProgrammaticallyRef.current) {
          closingProgrammaticallyRef.current = false
          return
        }
        close()
      }}
      onCancel={(e) => {
        e.preventDefault()
        playSound('modal-close')
        close()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          playSound('modal-close')
          close()
        }
      }}
    >
      <button
        className="icon-button dialog-close"
        data-sound="modal-close"
        onClick={close}
        aria-label={tr('关闭', 'Close')}
        type="button"
      >
        <Icon name="close" />
      </button>
      {children}
    </dialog>
  )
}
