import { Icon } from './Icon'
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
  onEdit?: () => void
  onClose: () => void
}) {
  const externalUrl = project ? safeExternalUrl(project.demoUrl) : null
  const galleryIds = project
    ? project.galleryAssetIds.filter((id) => id && id !== project.coverAssetId)
    : []

  return (
    <Modal
      open={open && project !== null}
      close={onClose}
      label={project?.title ?? '作品详情'}
      className="project-detail-dialog"
    >
      {project && (
        <>
          <div className="detail-meta-row">
            <span className="detail-kind-tag">作品室</span>
            {isPreview && <span className="status-badge draft">草稿预览（未发布内容仅主人可见）</span>}
            {!isPreview && project.publishedAt && (
              <span className="detail-date-tag">
                发布于 {new Date(project.publishedAt).toLocaleDateString('zh-CN')}
              </span>
            )}
          </div>

          <h2>{project.title || '未命名作品'}</h2>
          {project.summary && <p className="dialog-intro">{project.summary}</p>}

          {project.coverAssetId && (
            <figure className="detail-cover-frame">
              <SignedImage
                assetId={project.coverAssetId}
                scope={scope}
                variant="display"
                alt={`${project.title} 封面`}
                className="detail-cover-img"
              />
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
                <span>访问作品链接</span>
              </a>
            </div>
          )}

          {project.body && <div className="detail-body">{renderParagraphs(project.body)}</div>}

          {galleryIds.length > 0 && (
            <section className="detail-gallery-section" aria-label="作品截图">
              <h3>作品截图</h3>
              <div className="detail-gallery-list">
                {galleryIds.map((assetId, idx) => (
                  <figure key={assetId} className="detail-gallery-item">
                    <SignedImage
                      assetId={assetId}
                      scope={scope}
                      variant="display"
                      alt={`${project.title} 截图 ${idx + 1}`}
                      className="detail-gallery-img"
                    />
                  </figure>
                ))}
              </div>
            </section>
          )}

          {project.videoAssetId && (
            <section className="detail-video-section" aria-label="演示视频">
              <LazyVideoPlayer
                assetId={project.videoAssetId}
                scope={scope}
                active={open}
                label="项目演示视频"
              />
            </section>
          )}

          {linkedNotes.length > 0 && (
            <section className="detail-linked-section" aria-label="相关创作手记">
              <h3>相关创作手记</h3>
              <div className="linked-pill-list">
                {linkedNotes.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    className="linked-pill-btn"
                    onClick={() => onOpenNote?.(note.id)}
                  >
                    <Icon name="book" size={15} />
                    <span>{note.title}</span>
                    {note.isDraftOnly && <small className="mini-draft-tag">草稿</small>}
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
                  onClick={() => onStep(-1)}
                  aria-label="上一件作品"
                >
                  <Icon name="back" size={15} />
                  <span>上一件</span>
                </button>
                <span className="detail-pager-count">
                  {currentIndex + 1} / {totalCount}
                </span>
                <button
                  type="button"
                  className="cms-ghost-btn"
                  onClick={() => onStep(1)}
                  aria-label="下一件作品"
                >
                  <span>下一件</span>
                  <Icon name="arrow" size={15} />
                </button>
              </div>
            ) : (
              <span />
            )}

            {onEdit && (
              <button type="button" className="cms-primary-btn" onClick={onEdit}>
                <Icon name="pencil" size={15} />
                <span>编辑作品</span>
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
