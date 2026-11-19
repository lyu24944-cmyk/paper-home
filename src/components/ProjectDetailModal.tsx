import { useEffect, useMemo, useState } from 'react'
import { useI18n, type Locale } from '../lib/i18n'
import { Icon } from './Icon'
import { ImageLightbox, type LightboxImageItem } from './ImageLightbox'
import { LazyVideoPlayer } from './LazyVideoPlayer'
import { Modal } from './Modal'
import { SignedImage } from './SignedImage'
import { renderParagraphs, safeExternalUrl } from '../lib/text'
import type { ProjectPayload } from '../types/content'

export interface LinkedNoteRef {
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

export function ProjectDetailModal({
  open,
  project,
  scope = 'public',
  isPreview = false,
  linkedNotes = [],
  totalCount = 1,
  currentIndex = 0,
  onStep,
  onOpenNote,
  onCopyDeepLink,
  onOpenPostcard,
  onEdit,
  onClose,
}: {
  open: boolean
  project: (ProjectPayload & { id: string; publishedAt?: string | null }) | null
  scope?: 'public' | 'admin'
  isPreview?: boolean
  linkedNotes?: LinkedNoteRef[]
  totalCount?: number
  currentIndex?: number
  onStep?: (delta: -1 | 1) => void
  onOpenNote?: (noteId: string) => void
  onCopyDeepLink?: () => void
  onOpenPostcard?: () => void
  onEdit?: () => void
  onClose: () => void
}) {
  const { locale, tr } = useI18n()
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const externalUrl = project ? safeExternalUrl(project.demoUrl) : null
  const galleryIds = useMemo(
    () => (project ? project.galleryAssetIds.filter((id) => id && id !== project.coverAssetId) : []),
    [project],
  )

  const lightboxImages: LightboxImageItem[] = useMemo(() => {
    if (!project) return []
    const fallbackTitle = project.title || tr('作品', 'Project')
    const items: LightboxImageItem[] = []
    if (project.coverAssetId) {
      items.push({
        assetId: project.coverAssetId,
        alt: tr(`${fallbackTitle} 封面`, `${fallbackTitle} cover`),
        caption: tr(`${fallbackTitle} · 封面`, `${fallbackTitle} · Cover`),
      })
    }
    galleryIds.forEach((assetId, idx) => {
      items.push({
        assetId,
        alt: tr(`${fallbackTitle} 截图 ${idx + 1}`, `${fallbackTitle} screenshot ${idx + 1}`),
        caption: tr(`${fallbackTitle} · 截图 ${idx + 1}`, `${fallbackTitle} · Screenshot ${idx + 1}`),
      })
    })
    return items
  }, [galleryIds, project, tr])

  const readingMeta = project?.body ? formatReadingMeta(project.body, locale) : null

  useEffect(() => {
    setLightboxIndex(null)
  }, [open, project?.id])

  useEffect(() => {
    if (!open || !project || lightboxIndex !== null || !onStep || totalCount <= 1) return
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
  }, [open, project, lightboxIndex, onStep, totalCount])

  return (
    <>
      <Modal
        open={open && project !== null}
        close={() => {
          setLightboxIndex(null)
          onClose()
        }}
        label={project?.title ?? tr('作品详情', 'Project Details')}
        className="project-detail-dialog"
      >
        {project && (
          <>
            <div className="detail-meta-row">
              <span className="detail-kind-tag">{tr('作品室', 'Gallery')}</span>
              {readingMeta && <span className="detail-reading-tag">{readingMeta}</span>}
              {isPreview && (
                <span className="status-badge draft">
                  {tr('草稿预览（未发布内容仅主人可见）', 'Draft Preview (owner only)')}
                </span>
              )}
              {!isPreview && project.publishedAt && (
                <span className="detail-date-tag">
                  {tr(
                    `发布于 ${new Date(project.publishedAt).toLocaleDateString('zh-CN')}`,
                    `Published ${new Date(project.publishedAt).toLocaleDateString('en-US')}`,
                  )}
                </span>
              )}
            </div>

            <h2>{project.title || tr('未命名作品', 'Untitled Project')}</h2>
            {project.summary && <p className="dialog-intro">{project.summary}</p>}

            {project.coverAssetId && (
              <figure className="detail-cover-frame">
                <button
                  type="button"
                  className="detail-image-trigger"
                  data-sound="shutter"
                  onClick={() => setLightboxIndex(0)}
                  aria-label={tr(
                    `放大查看《${project.title || '作品'}》封面图`,
                    `Zoom cover image of ${project.title || 'project'}`,
                  )}
                >
                  <SignedImage
                    assetId={project.coverAssetId}
                    scope={scope}
                    variant="display"
                    alt={tr(`${project.title} 封面`, `${project.title} cover`)}
                    className="detail-cover-img"
                  />
                  <span className="image-zoom-hint" aria-hidden="true">
                    <Icon name="zoom" size={14} />
                    <span>{tr('查看大图', 'Zoom')}</span>
                  </span>
                </button>
              </figure>
            )}

            {externalUrl && (
              <div className="detail-link-row">
                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cms-ghost-btn detail-ext-link"
                >
                  <Icon name="link" size={16} />
                  <span>{tr('访问作品链接', 'Visit Project Link')}</span>
                </a>
              </div>
            )}

            {project.body && <div className="detail-body">{renderParagraphs(project.body)}</div>}

            {galleryIds.length > 0 && (
              <section className="detail-gallery-section" aria-label={tr('作品截图', 'Project screenshots')}>
                <h3>{tr('作品截图', 'Screenshots')}</h3>
                <div className="detail-gallery-list">
                  {galleryIds.map((assetId, idx) => {
                    const lbIndex = (project.coverAssetId ? 1 : 0) + idx
                    return (
                      <figure key={assetId} className="detail-gallery-item">
                        <button
                          type="button"
                          className="detail-image-trigger"
                          data-sound="shutter"
                          onClick={() => setLightboxIndex(lbIndex)}
                          aria-label={tr(`放大查看作品截图 ${idx + 1}`, `Zoom screenshot ${idx + 1}`)}
                        >
                          <SignedImage
                            assetId={assetId}
                            scope={scope}
                            variant="display"
                            alt={tr(`${project.title} 截图 ${idx + 1}`, `${project.title} screenshot ${idx + 1}`)}
                            className="detail-gallery-img"
                          />
                          <span className="image-zoom-hint" aria-hidden="true">
                            <Icon name="zoom" size={14} />
                            <span>{tr('查看大图', 'Zoom')}</span>
                          </span>
                        </button>
                      </figure>
                    )
                  })}
                </div>
              </section>
            )}

            {project.videoAssetId && (
              <section className="detail-video-section" aria-label={tr('演示视频', 'Demo video')}>
                <LazyVideoPlayer
                  assetId={project.videoAssetId}
                  scope={scope}
                  active={open}
                  label={tr('项目演示视频', 'Project Demo Video')}
                />
              </section>
            )}

            {linkedNotes.length > 0 && (
              <section className="detail-linked-section" aria-label={tr('相关创作手记', 'Related study notes')}>
                <h3>{tr('相关创作手记', 'Related Study Notes')}</h3>
                <div className="linked-pill-list">
                  {linkedNotes.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      className="linked-pill-btn"
                      data-sound="paper-card"
                      onClick={() => onOpenNote?.(note.id)}
                    >
                      <Icon name="book" size={15} />
                      <span>{note.title}</span>
                      {note.isDraftOnly && <small className="mini-draft-tag">{tr('草稿', 'Draft')}</small>}
                    </button>
                  ))}
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
                    aria-label={tr('上一件作品', 'Previous project')}
                  >
                    <Icon name="back" size={15} />
                    <span>{tr('上一件', 'Prev')}</span>
                  </button>
                  <span className="detail-pager-count">
                    {currentIndex + 1} / {totalCount}
                  </span>
                  <button
                    type="button"
                    className="cms-ghost-btn"
                    data-sound="paper-flip"
                    onClick={() => onStep(1)}
                    aria-label={tr('下一件作品', 'Next project')}
                  >
                    <span>{tr('下一件', 'Next')}</span>
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
                    <span>{tr('编辑作品', 'Edit Project')}</span>
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
