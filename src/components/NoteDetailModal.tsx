import { useEffect, useMemo, useState } from 'react'
import { useI18n, type Locale } from '../lib/i18n'
import { Icon } from './Icon'
import { ImageLightbox, type LightboxImageItem } from './ImageLightbox'
import { LazyVideoPlayer } from './LazyVideoPlayer'
import { Modal } from './Modal'
import { SignedImage } from './SignedImage'
import { renderParagraphs } from '../lib/text'
import type { NotePayload } from '../types/content'

export interface LinkedProjectRef {
  id: string
  title: string
  isDraftOnly?: boolean
}

function formatReadingMeta(body: string, locale: Locale): string | null {
  const chars = body.replace(/\s+/g, '').length
  if (chars === 0) return null
  if (locale === 'en') {
    const words = body.trim().split(/\s+/).filter(Boolean).length
    const minutes = Math.max(1, Math.ceil(words / 220))
    return `${words} words · ~${minutes} min read`
  }
  const minutes = Math.max(1, Math.ceil(chars / 380))
  return `${chars} 字 · 约 ${minutes} 分钟阅读`
}

export function NoteDetailModal({
  open,
  note,
  scope = 'public',
  isPreview = false,
  linkedProject = null,
  totalCount = 1,
  currentIndex = 0,
  onStep,
  onOpenProject,
  onCopyDeepLink,
  onOpenPostcard,
  onEdit,
  onClose,
}: {
  open: boolean
  note: (NotePayload & { id: string; publishedAt?: string | null }) | null
  scope?: 'public' | 'admin'
  isPreview?: boolean
  linkedProject?: LinkedProjectRef | null
  totalCount?: number
  currentIndex?: number
  onStep?: (delta: -1 | 1) => void
  onOpenProject?: (projectId: string) => void
  onCopyDeepLink?: () => void
  onOpenPostcard?: () => void
  onEdit?: () => void
  onClose: () => void
}) {
  const { locale, tr } = useI18n()
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const lightboxImages: LightboxImageItem[] = useMemo(() => {
    if (!note) return []
    return note.imageAssetIds.map((assetId, idx) => ({
      assetId,
      alt: tr(`${note.title || '手记'} 附图 ${idx + 1}`, `${note.title || 'Note'} image ${idx + 1}`),
      caption: tr(`${note.title || '创作手记'} · 附图 ${idx + 1}`, `${note.title || 'Study Note'} · Image ${idx + 1}`),
    }))
  }, [note, tr])

  const readingMeta = note?.body ? formatReadingMeta(note.body, locale) : null

  useEffect(() => {
    setLightboxIndex(null)
  }, [open, note?.id])

  useEffect(() => {
    if (!open || !note || lightboxIndex !== null || !onStep || totalCount <= 1) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        (active.matches('input, textarea, select, [contenteditable="true"]') ||
          active.isContentEditable)
      ) {
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onStep(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onStep(1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, note, lightboxIndex, onStep, totalCount])

  return (
    <>
      <Modal
        open={open && note !== null}
        close={() => {
          setLightboxIndex(null)
          onClose()
        }}
        label={note?.title ?? tr('手记正文', 'Study Note')}
        className="note-detail-dialog"
      >
        {note && (
          <>
            <div className="detail-meta-row">
              <span className="detail-kind-tag">{tr('创作手记', 'Study Note')}</span>
              {linkedProject && (
                <span className="detail-reading-tag">
                  {tr(`关联：${linkedProject.title}`, `Linked: ${linkedProject.title}`)}
                </span>
              )}
              {readingMeta && <span className="detail-reading-tag">{readingMeta}</span>}
              {isPreview && (
                <span className="status-badge draft">
                  {tr('草稿预览（未发布内容仅主人可见）', 'Draft Preview (owner only)')}
                </span>
              )}
              {!isPreview && note.publishedAt && (
                <span className="detail-date-tag">
                  {tr(
                    `发布于 ${new Date(note.publishedAt).toLocaleDateString('zh-CN')}`,
                    `Published ${new Date(note.publishedAt).toLocaleDateString('en-US')}`,
                  )}
                </span>
              )}
            </div>

            <h2>{note.title || tr('未命名手记', 'Untitled Note')}</h2>

            {note.body && <div className="detail-body">{renderParagraphs(note.body)}</div>}

            {note.imageAssetIds.length > 0 && (
              <section className="detail-gallery-section" aria-label={tr('手记附图', 'Note images')}>
                <h3>{tr('过程附图', 'Process Images')}</h3>
                <div className="detail-gallery-list">
                  {note.imageAssetIds.map((assetId, idx) => (
                    <figure key={assetId} className="detail-gallery-item">
                      <button
                        type="button"
                        className="detail-image-trigger"
                        data-sound="shutter"
                        onClick={() => setLightboxIndex(idx)}
                        aria-label={tr(`放大查看手记附图 ${idx + 1}`, `Zoom note image ${idx + 1}`)}
                      >
                        <SignedImage
                          assetId={assetId}
                          scope={scope}
                          variant="display"
                          alt={tr(`${note.title} 附图 ${idx + 1}`, `${note.title} image ${idx + 1}`)}
                          className="detail-gallery-img"
                        />
                        <span className="image-zoom-hint" aria-hidden="true">
                          <Icon name="zoom" size={14} />
                          <span>{tr('查看大图', 'Zoom')}</span>
                        </span>
                      </button>
                    </figure>
                  ))}
                </div>
              </section>
            )}

            {note.videoAssetId && (
              <section className="detail-video-section" aria-label={tr('手记视频', 'Note video')}>
                <LazyVideoPlayer
                  assetId={note.videoAssetId}
                  scope={scope}
                  active={open}
                  label={tr('手记过程视频', 'Note Process Video')}
                />
              </section>
            )}

            {linkedProject && (
              <section className="detail-linked-section" aria-label={tr('关联作品', 'Linked project')}>
                <h3>{tr('关联作品', 'Linked Project')}</h3>
                <div className="linked-pill-list">
                  <button
                    type="button"
                    className="linked-pill-btn"
                    data-sound="paper-card"
                    onClick={() => onOpenProject?.(linkedProject.id)}
                  >
                    <Icon name="frame" size={15} />
                    <span>{linkedProject.title}</span>
                    {linkedProject.isDraftOnly && <small className="mini-draft-tag">{tr('草稿', 'Draft')}</small>}
                  </button>
                </div>
              </section>
            )}

            <div className="detail-footer-bar">
              {onStep && totalCount > 1 ? (
                <div className="detail-pager">
                  <button
                    type="button"
                    className="cms-ghost-btn"
                    data-sound="paper-flip"
                    onClick={() => onStep(-1)}
                    aria-label={tr('上一篇手记', 'Previous note')}
                  >
                    <Icon name="back" size={15} />
                    <span>{tr('上一篇', 'Prev')}</span>
                  </button>
                  <span className="detail-pager-count">
                    {currentIndex + 1} / {totalCount}
                  </span>
                  <button
                    type="button"
                    className="cms-ghost-btn"
                    data-sound="paper-flip"
                    onClick={() => onStep(1)}
                    aria-label={tr('下一篇手记', 'Next note')}
                  >
                    <span>{tr('下一篇', 'Next')}</span>
                    <Icon name="arrow" size={15} />
                  </button>
                  <span className="detail-kbd-hint" aria-hidden="true">{tr('← / → 切换', '← / →')}</span>
                </div>
              ) : (
                <span />
              )}

              <div className="detail-footer-actions">
                {onCopyDeepLink && (
                  <button
                    type="button"
                    className="cms-ghost-btn"
                    data-sound="paper-card"
                    onClick={onCopyDeepLink}
                  >
                    <Icon name="copy" size={15} />
                    <span>{tr('复制深链', 'Copy Link')}</span>
                  </button>
                )}
                {onOpenPostcard && (
                  <button
                    type="button"
                    className="cms-ghost-btn"
                    data-sound="shutter"
                    onClick={onOpenPostcard}
                  >
                    <Icon name="postcard" size={15} />
                    <span>{tr('拍明信片', 'Postcard')}</span>
                  </button>
                )}
                {onEdit && (
                  <button type="button" className="cms-primary-btn" onClick={onEdit}>
                    <Icon name="pencil" size={15} />
                    <span>{tr('编辑手记', 'Edit Note')}</span>
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </Modal>

      <ImageLightbox
        open={open && lightboxIndex !== null}
        images={lightboxImages}
        index={lightboxIndex ?? 0}
        scope={scope}
        onIndexChange={(next) => setLightboxIndex(next)}
        onClose={() => setLightboxIndex(null)}
      />
    </>
  )
}
