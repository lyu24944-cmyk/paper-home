import { useEffect, useRef, useState } from 'react'
import { isUrlNearExpiry, refreshSignedUrl } from '../lib/media'
import { Icon } from './Icon'

export function LazyVideoPlayer({
  assetId,
  scope = 'public',
  active = true,
  label = '演示视频',
}: {
  assetId: string | null | undefined
  scope?: 'public' | 'admin'
  active?: boolean
  label?: string
}) {
  const [requested, setRequested] = useState(false)
  const [loading, setLoading] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)

  const stopPlayback = () => {
    const el = videoRef.current
    if (el) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    setRequested(false)
    setVideoUrl(null)
  }

  useEffect(() => {
    if (!active) {
      stopPlayback()
      setError('')
    }
  }, [active, assetId])

  useEffect(() => () => stopPlayback(), [])

  if (!assetId) return null

  async function onPlayRequest() {
    if (!assetId) return
    setLoading(true)
    setError('')
    const entry = await refreshSignedUrl(assetId, scope, isUrlNearExpiry(assetId))
    setLoading(false)
    if (!entry?.displayUrl) {
      setError('演示视频暂不可用或已撤回。')
      return
    }
    setVideoUrl(entry.displayUrl)
    setRequested(true)
    requestAnimationFrame(() => {
      void videoRef.current?.play().catch(() => {
        // Controls remain visible if browser blocks autoplay.
      })
    })
  }

  if (!requested || !videoUrl) {
    return (
      <div className="video-lazy-box">
        <div className="video-lazy-info">
          <Icon name="play" size={18} />
          <span>{label}（点击后加载，不提前消耗流量）</span>
        </div>
        <button
          type="button"
          className="cms-primary-btn"
          data-sound="ui-switch"
          disabled={loading}
          onClick={() => void onPlayRequest()}
        >
          <Icon name="play" size={16} />
          <span>{loading ? '正在获取播放链接…' : '加载并播放演示视频'}</span>
        </button>
        {error && <p className="cms-error-inline" role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <div className="video-player-wrap">
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        playsInline
        preload="metadata"
        className="detail-video"
        onError={() => {
          setError('视频链接已过期或不可播放，请重新点击加载。')
          stopPlayback()
        }}
      />
      <div className="video-player-actions">
        <button type="button" className="cms-ghost-btn" data-sound="modal-close" onClick={stopPlayback}>
          收起并停止播放
        </button>
      </div>
    </div>
  )
}
