import { useEffect, useRef } from 'react'
import { useI18n } from '../lib/i18n'
import { playSound } from '../lib/sound'
import { Icon } from './Icon'
import { SignedImage } from './SignedImage'

export interface LightboxImageItem {
  assetId: string
  alt: string
  caption?: string
}

export function ImageLightbox({
  open,
  images,
  index,
  scope = 'public',
  onIndexChange,
  onClose,
}: {
  open: boolean
  images: LightboxImageItem[]
  index: number
  scope?: 'public' | 'admin'
  onIndexChange: (nextIndex: number) => void
  onClose: () => void
}) {
  const { tr } = useI18n()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const count = images.length
  const safeIndex = count > 0 ? Math.max(0, Math.min(index, count - 1)) : 0
  const current = count > 0 ? images[safeIndex] : null

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open && current && !el.open) {
      el.showModal()
    } else if ((!open || !current) && el.open) {
      el.close()
    }
  }, [open, current])

  useEffect(() => {
    if (!open || !current) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        playSound('modal-close')
        onClose()
      } else if (e.key === 'ArrowLeft' && count > 1) {
        e.preventDefault()
        e.stopPropagation()
        onIndexChange((safeIndex - 1 + count) % count)
      } else if (e.key === 'ArrowRight' && count > 1) {
        e.preventDefault()
        e.stopPropagation()
        onIndexChange((safeIndex + 1) % count)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, current, count, safeIndex, onIndexChange, onClose])

  return (
    <dialog
      ref={dialogRef}
      className="lightbox-dialog"
      aria-label={current?.caption || current?.alt || tr('图片大图预览', 'Image preview')}
      onCancel={(e) => {
        e.preventDefault()
        e.stopPropagation()
        playSound('modal-close')
        onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          playSound('modal-close')
          onClose()
        }
      }}
    >
      {current && (
        <div
          className="lightbox-shell"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              playSound('modal-close')
              onClose()
            }
          }}
        >
          <div className="lightbox-topbar">
            <span className="lightbox-counter">
              {count > 1 ? `${safeIndex + 1} / ${count}` : tr('原图预览', 'Full-size preview')}
              {current.caption ? ` · ${current.caption}` : ''}
            </span>
            <button
              type="button"
              className="lightbox-close-btn"
              data-sound="modal-close"
              onClick={onClose}
              aria-label={tr('关闭大图预览', 'Close image preview')}
            >
              <Icon name="close" size={20} />
              <span>{tr('关闭', 'Close')}</span>
            </button>
          </div>

          <div
            className="lightbox-stage"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                playSound('modal-close')
                onClose()
              }
            }}
          >
            {count > 1 && (
              <button
                type="button"
                className="lightbox-arrow-btn prev"
                data-sound="shutter"
                onClick={() => onIndexChange((safeIndex - 1 + count) % count)}
                aria-label={tr('上一张图片', 'Previous image')}
              >
                <Icon name="back" size={22} />
              </button>
            )}

            <figure className="lightbox-figure">
              <SignedImage
                key={current.assetId}
                assetId={current.assetId}
                scope={scope}
                variant="display"
                alt={current.alt}
                className="lightbox-img"
              />
            </figure>

            {count > 1 && (
              <button
                type="button"
                className="lightbox-arrow-btn next"
                data-sound="shutter"
                onClick={() => onIndexChange((safeIndex + 1) % count)}
                aria-label={tr('下一张图片', 'Next image')}
              >
                <Icon name="arrow" size={22} />
              </button>
            )}
          </div>

          {count > 1 && (
            <div className="lightbox-dots" role="tablist" aria-label={tr('切换预览图片', 'Switch preview image')}>
              {images.map((item, idx) => (
                <button
                  key={`${item.assetId}-${idx}`}
                  type="button"
                  role="tab"
                  data-sound="shutter"
                  aria-selected={idx === safeIndex}
                  aria-label={tr(`查看第 ${idx + 1} 张图片`, `View image ${idx + 1}`)}
                  className={`lightbox-dot-btn ${idx === safeIndex ? 'active' : ''}`}
                  onClick={() => onIndexChange(idx)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </dialog>
  )
}
