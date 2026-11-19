import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n'
import {
  POSTCARD_PRESET_QUOTES,
  POSTCARD_PRESET_QUOTES_EN,
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
  const { locale, tr } = useI18n()
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
        locale,
      }),
    )
  }, [open, room, atmospherePreset, weather, itemLabel, nowNote, locale])

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
        locale,
      })
        .then((res) => {
          if (active) setRendered(res)
        })
        .catch(() => {
          if (active) onNotify(tr('明信片生成失败，请重试。', 'Failed to render postcard. Please retry.'), 'error')
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
    locale,
    onNotify,
    tr,
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
    onNotify(
      tr('已下载纸质小屋明信片（1200×1560 PNG）', 'Downloaded paper postcard (1200×1560 PNG)'),
      'success',
    )
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
      onNotify(tr('明信片图片已复制到剪贴板', 'Postcard image copied to clipboard'), 'success')
    } catch {
      onNotify(
        tr('当前浏览器限制直接复制图片，已为你改为下载 PNG', 'Direct image copy is blocked by browser—downloading PNG instead'),
        'info',
      )
      handleDownload()
    }
  }

  function handleCyclePreset() {
    const pool = locale === 'en' ? POSTCARD_PRESET_QUOTES_EN : POSTCARD_PRESET_QUOTES
    const nextIdx = (quoteIdx + 1) % pool.length
    setQuoteIdx(nextIdx)
    setMessage(pool[nextIdx])
    playSound('paper-flip')
  }

  return (
    <Modal open={open} close={onClose} label={tr('纸质小屋明信片', 'Paper Cottage Postcard')} className="postcard-dialog">
      <h2>{tr('拍一张纸质明信片', 'Create a Paper Postcard')}</h2>
      <p className="dialog-intro">
        {tr(
          `定格此刻的「${roomName}」天色与光影，可保存图片分享或扫码直达同一瞬间。`,
          `Capture the light and mood of "${roomName}" right now—save as PNG or share the scannable deep link.`,
        )}
      </p>

      <div className="postcard-workspace">
        <div className="postcard-preview-frame" aria-live="polite">
          {rendered?.dataUrl ? (
            <img
              src={rendered.dataUrl}
              alt={tr(`${homeName} · ${roomName} 纸质明信片预览`, `${homeName} · ${roomName} postcard preview`)}
              className="postcard-preview-img"
            />
          ) : (
            <div className="postcard-preview-loading">
              {rendering ? tr('正在冲印明信片…', 'Developing postcard…') : tr('正在准备取景框…', 'Preparing viewfinder…')}
            </div>
          )}
        </div>

        <div className="postcard-controls">
          <div className="cms-field">
            <div className="cms-field-head">
              <label htmlFor="postcard-message-input">{tr('手写寄语', 'Postcard Message')}</label>
              <button
                type="button"
                className="cms-ghost-btn postcard-preset-btn"
                data-sound="paper-flip"
                onClick={handleCyclePreset}
              >
                {tr('换一句寄语', 'Try Another Quote')}
              </button>
            </div>
            <textarea
              id="postcard-message-input"
              rows={3}
              maxLength={72}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={tr('写一句寄往这个房间的短语（最多 72 字）', 'Write a short note from this room (up to 72 chars)')}
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
            <span>{tr('在右下角印上直达深链二维码', 'Print scannable deep-link QR code')}</span>
          </label>

          <div className="postcard-deeplink-box" aria-label={tr('直达深链地址', 'Deep link address')}>
            <div className="postcard-deeplink-head">
              <span>{tr('此刻瞬间深链', 'Moment Deep Link')}</span>
              <button
                type="button"
                className="cms-ghost-btn postcard-copy-link-btn"
                data-sound="paper-card"
                onClick={onCopyDeepLink}
              >
                <Icon name="copy" size={14} />
                <span>{tr('复制深链', 'Copy Link')}</span>
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
              <span>{tr('下载明信片 PNG', 'Download PNG')}</span>
            </button>
            <button
              type="button"
              className="cms-ghost-btn"
              disabled={!rendered?.dataUrl}
              onClick={() => void handleCopyImage()}
            >
              <Icon name="copy" size={15} />
              <span>{tr('复制图片', 'Copy Image')}</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
