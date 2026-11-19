import { useState } from 'react'
import { useI18n } from '../lib/i18n'
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
  const { tr } = useI18n()
  const [showCloud, setShowCloud] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')

  async function handleCopy() {
    if (!conflict) return
    try {
      await navigator.clipboard.writeText(conflict.localCopyText)
      setCopyStatus(tr('当前编辑内容已复制到剪贴板。', 'Your current draft has been copied to the clipboard.'))
    } catch {
      setCopyStatus(tr('浏览器未授权自动复制，请返回编辑器手动全选复制。', 'Clipboard access was blocked—please return to the editor and copy manually.'))
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
      label={conflict?.title ?? tr('版本冲突', 'Version Conflict')}
      className="conflict-dialog"
    >
      {conflict && (
        <>
          <h2>{tr('检测到云端更新冲突', 'Update Conflict Detected')}</h2>
          <p className="dialog-intro">
            {tr(
              `另一台设备刚刚更新了「${conflict.title}」。为避免静默覆盖，你当前的输入已完整保留。`,
              `Another session just updated "${conflict.title}". Your current edits have been preserved so nothing is overwritten.`,
            )}
          </p>

          <div className="conflict-actions">
            <button
              type="button"
              className="cms-ghost-btn"
              onClick={() => setShowCloud((v) => !v)}
            >
              <Icon name="eye" size={16} />
              <span>{showCloud ? tr('收起云端版本', 'Hide Latest Version') : tr('查看云端版本', 'View Latest Version')}</span>
            </button>
            <button type="button" className="cms-ghost-btn" onClick={() => void handleCopy()}>
              <Icon name="copy" size={16} />
              <span>{tr('复制当前内容', 'Copy My Draft')}</span>
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
              <span>{tr('使用云端版本刷新', 'Reload Latest Version')}</span>
            </button>
          </div>

          {copyStatus && <p className="name-message" role="status">{copyStatus}</p>}

          {showCloud && (
            <div className="cloud-preview-box">
              <h3>{tr('云端最新内容摘要', 'Latest Version Summary')}</h3>
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
              {tr('保留当前编辑继续处理', 'Keep My Edits & Continue')}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
