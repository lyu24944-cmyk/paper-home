import { useEffect, useRef, useState } from 'react'
import { getCachedUrl, isUrlNearExpiry, refreshSignedUrl } from '../lib/media'

export function SignedImage({
  assetId,
  scope = 'public',
  variant = 'display',
  alt,
  className = '',
}: {
  assetId: string | null | undefined
  scope?: 'public' | 'admin'
  variant?: 'display' | 'thumb'
  alt: string
  className?: string
}) {
  const [src, setSrc] = useState<string | null>(() => getCachedUrl(assetId, variant, scope))
  const [retried, setRetried] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const mountedRef = useRef(true)
  const activeKeyRef = useRef(`${scope}:${assetId ?? ''}:${variant}`)
  activeKeyRef.current = `${scope}:${assetId ?? ''}:${variant}`

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const reqKey = `${scope}:${assetId ?? ''}:${variant}`
    setRetried(false)
    setUnavailable(false)
    if (!assetId) {
      setSrc(null)
      return
    }
    const cached = getCachedUrl(assetId, variant, scope)
    setSrc(cached)
    if (!cached || isUrlNearExpiry(assetId, scope)) {
      let active = true
      void refreshSignedUrl(assetId, scope, !cached).then((entry) => {
        if (!active || !mountedRef.current || activeKeyRef.current !== reqKey) return
        if (!entry) {
          setSrc(null)
          setUnavailable(true)
        } else {
          setSrc(variant === 'thumb' ? (entry.thumbUrl ?? entry.displayUrl) : entry.displayUrl)
        }
      })
      return () => {
        active = false
      }
    }
  }, [assetId, scope, variant])

  if (!assetId) return null

  if (unavailable) {
    return (
      <div className={`media-unavailable ${className}`} role="status">
        图片暂不可用或已撤回
      </div>
    )
  }

  if (!src) {
    return <div className={`media-loading-box ${className}`} aria-hidden="true" />
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => {
        if (retried || !assetId) {
          setUnavailable(true)
          return
        }
        const errKey = `${scope}:${assetId}:${variant}`
        setRetried(true)
        void refreshSignedUrl(assetId, scope, true).then((entry) => {
          if (!mountedRef.current || activeKeyRef.current !== errKey) return
          if (!entry) {
            setUnavailable(true)
          } else {
            setSrc(variant === 'thumb' ? (entry.thumbUrl ?? entry.displayUrl) : entry.displayUrl)
          }
        })
      }}
    />
  )
}
