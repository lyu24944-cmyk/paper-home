import { useEffect, useRef, type ReactNode } from 'react'
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
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={dialog}
      className={`paper-dialog ${className}`}
      aria-label={label}
      onClose={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <button className="icon-button dialog-close" onClick={close} aria-label="关闭" type="button">
        <Icon name="close" />
      </button>
      {children}
    </dialog>
  )
}
