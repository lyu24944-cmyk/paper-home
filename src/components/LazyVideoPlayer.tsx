import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { isUrlNearExpiry, refreshSignedUrl } from '../lib/media'
import { Icon } from './Icon'

export function LazyVideoPlayer({
  assetId,
  scope = 'public',
  active = true,
  label,
}: {
  assetId: string | null | undefined
  scope?: 'public' | 'admin'
  active?: boolean
  label?: string
}) {
  const { tr } = useI18n()
  const resolvedLabel = label ?? tr('演示视频', 'Demo Video')
  const [requested, setRequested] = useState(false)
  const [loading, setLoading] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const mountedRef = useRef(true)
  const reqSeqRef = useRef(0)

  const stopPlayback = () => {
    reqSeqRef.current += 1
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
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopPlayback()
    }
  }, [])

  useEffect(() => {
    if (!active) {
      stopPlayback()
      setError('')
    }
  }, [active])

  useEffect(() => {
    stopPlayback()
    setError('')
    setLoading(false)
  }, [assetId, scope])

  if (!assetId) return null

  async function onPlayRequest() {
    if (!assetId) return
    const seq = ++reqSeqRef.current
    setLoading(true)
    setError('')
    const entry = await refreshSignedUrl(assetId, scope, isUrlNearExpiry(assetId, scope))
    if (!mountedRef.current || reqSeqRef.current !== seq) return
    setLoading(false)
    if (!entry?.displayUrl) {
      setError(tr('演示视频暂不可用或已撤回。', 'Video is unavailable or has been unpublished.'))
      return
    }
    setVideoUrl(entry.displayUrl)
    setRequested(true)
    requestAnimationFrame(() => {
      if (!mountedRef.current || reqSeqRef.current !== seq) return
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
          <span>{resolvedLabel}{tr('（点击后加载，不提前消耗流量）', ' (loads on demand when clicked)')}</span>
        </div>
        <button
          type="button"
          className="cms-primary-btn"
          data-sound="ui-switch"
          disabled={loading}
          onClick={() => void onPlayRequest()}
        >
          <Icon name="play" size={16} />
          <span>{loading ? tr('正在获取播放链接…', 'Preparing video stream…') : tr('加载并播放演示视频', 'Load & Play Video')}</span>
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
          setError(tr('视频链接已过期或不可播放，请重新点击加载。', 'Video link expired or unplayable—please reload it.'))
          stopPlayback()
        }}
      />
      <div className="video-player-actions">
        <button type="button" className="cms-ghost-btn" data-sound="modal-close" onClick={stopPlayback}>
          {tr('收起并停止播放', 'Close & Stop Video')}
        </button>
      </div>
    </div>
  )
}
