import { useEffect, useState } from 'react'
import {
  POSTCARD_PRESET_QUOTES,
  defaultPostcardMessage,
  renderPostcardCanvas,
  type RenderedPostcard,
} from '../lib/postcard'
import { playSound } from '../lib/sound'
import type { AtmospherePreset, Place, WeatherMode } from '../types/content'
import { Icon } from './Icon'
import { Modal } from './Modal'

export function PostcardModal({
  open,
  snapshotDataUrl,
  homeName,
  plaqueTitle,
  room,
  roomName,
  atmospherePreset,
  weather,
  itemLabel,
  nowNote,
  deepLinkUrl,
  deepLinkHash,
  onCopyDeepLink,
  onNotify,
  onClose,
}: {
  open: boolean
  snapshotDataUrl: string | null
  homeName: string
  plaqueTitle: string
  room: Place
  roomName: string
  atmospherePreset: AtmospherePreset
  weather: WeatherMode
  itemLabel?: string | null
  nowNote?: string | null
  deepLinkUrl: string
  deepLinkHash: string
  onCopyDeepLink: () => void
  onNotify: (message: string, tone?: 'success' | 'info' | 'error') => void
  onClose: () => void
}) {
  const [message, setMessage] = useState('')
  const [includeQr, setIncludeQr] = useState(true)
  const [rendered, setRendered] = useState<RenderedPostcard | null>(null)
  const [rendering, setRendering] = useState(false)
  const [quoteIdx, setQuoteIdx] = useState(0)

  useEffect(() => {
    if (!open) return
    setMessage(
      defaultPostcardMessage({
        room,
        atmospherePreset,
        weather,
        itemLabel,
        nowNote,
      }),
    )
  }, [open, room, atmospherePreset, weather, itemLabel, nowNote])

  useEffect(() => {
    if (!open) {
      setRendered(null)
      return
    }
    let active = true
    setRendering(true)
    const timer = window.setTimeout(() => {
      void renderPostcardCanvas({
        snapshotDataUrl,
        homeName,
        plaqueTitle,
        room,
        roomName,
        atmospherePreset,
        weather,
        message,
        itemLabel,
        deepLinkUrl,
        deepLinkHash,
        includeQr,
      })
        .then((res) => {
          if (active) setRendered(res)
        })
        .catch(() => {
          if (active) onNotify('明信片生成失败，请重试。', 'error')
        })
        .finally(() => {
          if (active) setRendering(false)
        })
    }, 60)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [
    open,
    snapshotDataUrl,
    homeName,
    plaqueTitle,
    room,
    roomName,
    atmospherePreset,
    weather,
    message,
    itemLabel,
    deepLinkUrl,
    deepLinkHash,
    includeQr,
    onNotify,
  ])

  function handleDownload() {
    if (!rendered?.dataUrl) return
    const a = document.createElement('a')
    a.href = rendered.dataUrl
    a.download = `paper-home-${room}-${atmospherePreset}${weather === 'rain' ? '-rain' : ''}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    playSound('success-seal')
    onNotify('已下载纸质小屋明信片（1200×1560 PNG）', 'success')
  }

  async function handleCopyImage() {
    if (!rendered?.blob) {
      handleDownload()
      return
    }
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        throw new Error('ClipboardItem unavailable')
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': rendered.blob })])
      playSound('success-seal')
      onNotify('明信片图片已复制到剪贴板', 'success')
    } catch {
      onNotify('当前浏览器限制直接复制图片，已为你改为下载 PNG', 'info')
      handleDownload()
    }
  }

  function handleCyclePreset() {
    const nextIdx = (quoteIdx + 1) % POSTCARD_PRESET_QUOTES.length
    setQuoteIdx(nextIdx)
    setMessage(POSTCARD_PRESET_QUOTES[nextIdx])
    playSound('paper-flip')
  }

  return (
    <Modal open={open} close={onClose} label="纸质小屋明信片" className="postcard-dialog">
      <h2>拍一张纸质明信片</h2>
      <p className="dialog-intro">
        定格此刻的「{roomName}」天色与光影，可保存图片分享或扫码直达同一瞬间。
      </p>

      <div className="postcard-workspace">
        <div className="postcard-preview-frame" aria-live="polite">
          {rendered?.dataUrl ? (
            <img
              src={rendered.dataUrl}
              alt={`${homeName} · ${roomName} 纸质明信片预览`}
              className="postcard-preview-img"
            />
          ) : (
            <div className="postcard-preview-loading">
              {rendering ? '正在冲印明信片…' : '正在准备取景框…'}
            </div>
          )}
        </div>

        <div className="postcard-controls">
          <div className="cms-field">
            <div className="cms-field-head">
              <label htmlFor="postcard-message-input">手写寄语</label>
              <button
                type="button"
                className="cms-ghost-btn postcard-preset-btn"
                data-sound="paper-flip"
                onClick={handleCyclePreset}
              >
                换一句寄语
              </button>
            </div>
            <textarea
              id="postcard-message-input"
              rows={3}
              maxLength={72}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="写一句寄往这个房间的短语（最多 72 字）"
            />
            <div className="postcard-char-row">
              <span className="cms-char-count">{message.length} / 72</span>
            </div>
          </div>

          <label className="postcard-qr-toggle">
            <input
              type="checkbox"
              checked={includeQr}
              onChange={(e) => setIncludeQr(e.target.checked)}
            />
            <span>在右下角印上直达深链二维码</span>
          </label>

          <div className="postcard-deeplink-box" aria-label="直达深链地址">
            <div className="postcard-deeplink-head">
              <span>此刻瞬间深链</span>
              <button
                type="button"
                className="cms-ghost-btn postcard-copy-link-btn"
                data-sound="paper-card"
                onClick={onCopyDeepLink}
              >
                <Icon name="copy" size={14} />
                <span>复制深链</span>
              </button>
            </div>
            <code>{deepLinkHash}</code>
          </div>

          <div className="postcard-actions">
            <button
              type="button"
              className="cms-primary-btn"
              disabled={!rendered?.dataUrl}
              onClick={handleDownload}
            >
              <Icon name="download" size={16} />
              <span>下载明信片 PNG</span>
            </button>
            <button
              type="button"
              className="cms-ghost-btn"
              disabled={!rendered?.dataUrl}
              onClick={() => void handleCopyImage()}
            >
              <Icon name="copy" size={15} />
              <span>复制图片</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
