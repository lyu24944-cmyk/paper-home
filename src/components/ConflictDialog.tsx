import { useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'

export interface ConflictContext {
  title: string
  localCopyText: string
  cloudSummaryLines: string[]
  onUseCloud: () => void
}

export function ConflictDialog({
  conflict,
  onClose,
}: {
  conflict: ConflictContext | null
  onClose: () => void
}) {
  const [showCloud, setShowCloud] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')

  async function handleCopy() {
    if (!conflict) return
    try {
      await navigator.clipboard.writeText(conflict.localCopyText)
      setCopyStatus('当前编辑内容已复制到剪贴板。')
    } catch {
      setCopyStatus('浏览器未授权自动复制，请返回编辑器手动全选复制。')
    }
  }

  return (
    <Modal
      open={conflict !== null}
      close={() => {
        setShowCloud(false)
        setCopyStatus('')
        onClose()
      }}
      label={conflict?.title ?? '版本冲突'}
      className="conflict-dialog"
    >
      {conflict && (
        <>
          <h2>检测到云端更新冲突</h2>
          <p className="dialog-intro">
            另一台设备刚刚更新了「{conflict.title}」。为避免静默覆盖，你当前的输入已完整保留。
          </p>

          <div className="conflict-actions">
            <button
              type="button"
              className="cms-ghost-btn"
              onClick={() => setShowCloud((v) => !v)}
            >
              <Icon name="eye" size={16} />
              <span>{showCloud ? '收起云端版本' : '查看云端版本'}</span>
            </button>
            <button type="button" className="cms-ghost-btn" onClick={() => void handleCopy()}>
              <Icon name="copy" size={16} />
              <span>复制当前内容</span>
            </button>
            <button
              type="button"
              className="cms-primary-btn"
              onClick={() => {
                setShowCloud(false)
                setCopyStatus('')
                conflict.onUseCloud()
                onClose()
              }}
            >
              <Icon name="refresh" size={16} />
              <span>使用云端版本刷新</span>
            </button>
          </div>

          {copyStatus && <p className="name-message" role="status">{copyStatus}</p>}

          {showCloud && (
            <div className="cloud-preview-box">
              <h3>云端最新内容摘要</h3>
              {conflict.cloudSummaryLines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          )}

          <div className="dialog-actions-row">
            <button
              type="button"
              className="cms-ghost-btn"
              onClick={() => {
                setShowCloud(false)
                setCopyStatus('')
                onClose()
              }}
            >
              保留当前编辑继续处理
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
