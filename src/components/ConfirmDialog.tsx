import { Modal } from './Modal'

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认删除',
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
  return (
    <Modal open={open} close={onCancel} label={title} className="confirm-dialog">
      <h2>{title}</h2>
      <p className="dialog-intro">{message}</p>
      {error && <p className="cms-error-inline" role="alert">{error}</p>}
      <div className="dialog-actions-row">
        <button type="button" className="cms-ghost-btn" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button type="button" className="cms-danger-btn" onClick={onConfirm} disabled={busy}>
          {busy ? '处理中…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
