import { Icon } from './Icon'
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
  return (
    <Modal
      open={open && note !== null}
      close={onClose}
      label={note?.title ?? '手记正文'}
      className="note-detail-dialog"
    >
      {note && (
        <>
          <div className="detail-meta-row">
            <span className="detail-kind-tag">创作手记</span>
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
                    <SignedImage
                      assetId={assetId}
                      scope={scope}
                      variant="display"
                      alt={`${note.title} 附图 ${idx + 1}`}
                      className="detail-gallery-img"
                    />
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
  )
}
