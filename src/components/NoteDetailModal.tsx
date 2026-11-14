import { useEffect, useMemo, useState } from 'react'
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

function formatReadingMeta(body: string): string | null {
  const chars = body.replace(/\s+/g, '').length
  if (chars === 0) return null
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
  onEdit?: () => void
  onClose: () => void
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const lightboxImages: LightboxImageItem[] = useMemo(() => {
    if (!note) return []
    return note.imageAssetIds.map((assetId, idx) => ({
      assetId,
      alt: `${note.title || '手记'} 附图 ${idx + 1}`,
      caption: `${note.title || '创作手记'} · 附图 ${idx + 1}`,
    }))
  }, [note])

  const readingMeta = note?.body ? formatReadingMeta(note.body) : null

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
        label={note?.title ?? '手记正文'}
        className="note-detail-dialog"
      >
        {note && (
          <>
            <div className="detail-meta-row">
              <span className="detail-kind-tag">创作手记</span>
              {linkedProject && (
                <span className="detail-reading-tag">关联：{linkedProject.title}</span>
              )}
              {readingMeta && <span className="detail-reading-tag">{readingMeta}</span>}
              {isPreview && <span className="status-badge draft">草稿预览（未发布内容仅主人可见）</span>}
              {!isPreview && note.publishedAt && (
                <span className="detail-date-tag">
                  发布于 {new Date(note.publishedAt).toLocaleDateString('zh-CN')}
                </span>
              )}
            </div>

            <h2>{note.title || '未命名手记'}</h2>

            {note.body && <div className="detail-body">{renderParagraphs(note.body)}</div>}

            {note.imageAssetIds.length > 0 && (
              <section className="detail-gallery-section" aria-label="手记附图">
                <h3>过程附图</h3>
                <div className="detail-gallery-list">
                  {note.imageAssetIds.map((assetId, idx) => (
                    <figure key={assetId} className="detail-gallery-item">
                      <button
                        type="button"
                        className="detail-image-trigger"
                        onClick={() => setLightboxIndex(idx)}
                        aria-label={`放大查看手记附图 ${idx + 1}`}
                      >
                        <SignedImage
                          assetId={assetId}
                          scope={scope}
                          variant="display"
                          alt={`${note.title} 附图 ${idx + 1}`}
                          className="detail-gallery-img"
                        />
                        <span className="image-zoom-hint" aria-hidden="true">
                          <Icon name="zoom" size={14} />
                          <span>查看大图</span>
                        </span>
                      </button>
                    </figure>
                  ))}
                </div>
              </section>
            )}

            {note.videoAssetId && (
              <section className="detail-video-section" aria-label="手记视频">
                <LazyVideoPlayer
                  assetId={note.videoAssetId}
                  scope={scope}
                  active={open}
                  label="手记过程视频"
                />
              </section>
            )}

            {linkedProject && (
              <section className="detail-linked-section" aria-label="关联作品">
                <h3>关联作品</h3>
                <div className="linked-pill-list">
                  <button
                    type="button"
                    className="linked-pill-btn"
                    onClick={() => onOpenProject?.(linkedProject.id)}
                  >
                    <Icon name="frame" size={15} />
                    <span>{linkedProject.title}</span>
                    {linkedProject.isDraftOnly && <small className="mini-draft-tag">草稿</small>}
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
                    onClick={() => onStep(-1)}
                    aria-label="上一篇手记"
                  >
                    <Icon name="back" size={15} />
                    <span>上一篇</span>
                  </button>
                  <span className="detail-pager-count">
                    {currentIndex + 1} / {totalCount}
                  </span>
                  <button
                    type="button"
                    className="cms-ghost-btn"
                    onClick={() => onStep(1)}
                    aria-label="下一篇手记"
                  >
                    <span>下一篇</span>
                    <Icon name="arrow" size={15} />
                  </button>
                  <span className="detail-kbd-hint" aria-hidden="true">← / → 切换</span>
                </div>
              ) : (
                <span />
              )}

              {onEdit && (
                <button type="button" className="cms-primary-btn" onClick={onEdit}>
                  <Icon name="pencil" size={15} />
                  <span>编辑手记</span>
                </button>
              )}
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
