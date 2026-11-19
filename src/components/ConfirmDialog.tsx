import { useI18n } from '../lib/i18n'
import { Modal } from './Modal'

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  busy = false,
  error = '',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  busy?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { tr } = useI18n()
  const resolvedConfirm = confirmLabel ?? tr('确认删除', 'Confirm Delete')
  return (
    <Modal open={open} close={onCancel} label={title} className="confirm-dialog">
      <h2>{title}</h2>
      <p className="dialog-intro">{message}</p>
      {error && <p className="cms-error-inline" role="alert">{error}</p>}
      <div className="dialog-actions-row">
        <button type="button" className="cms-ghost-btn" onClick={onCancel} disabled={busy}>
          {tr('取消', 'Cancel')}
        </button>
        <button type="button" className="cms-danger-btn" onClick={onConfirm} disabled={busy}>
          {busy ? tr('处理中…', 'Working…') : resolvedConfirm}
        </button>
      </div>
    </Modal>
  )
}
