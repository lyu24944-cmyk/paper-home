import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import {
  cleanupMediaAssetsApi,
  deleteNoteApi,
  publishNoteApi,
  saveNoteDraftApi,
  unpublishNoteApi,
} from '../lib/api'
import { buildStatusLabel, renderParagraphs } from '../lib/text'
import { isCloudConfigured } from '../lib/supabase'
import {
  ConflictError,
  type AdminNote,
  type AdminProject,
  type MediaAsset,
  type NotePayload,
} from '../types/content'
import { ConfirmDialog } from './ConfirmDialog'
import type { ConflictContext } from './ConflictDialog'
import { Icon } from './Icon'
import { MarkdownToolbar } from './MarkdownToolbar'
import { ImageListPicker, VideoUploadPicker } from './MediaPickers'
import { Modal } from './Modal'
import type { SaveActionKind } from './ProjectEditorModal'

export function NoteEditorModal({
  open,
  initialNote,
  projects,
  assets,
  onAssetUploaded,
  onSaved,
  onDeleted,
  onPreview,
  onConflict,
  onClose,
}: {
  open: boolean
  initialNote: AdminNote | null
  projects: AdminProject[]
  assets: Record<string, MediaAsset>
  onAssetUploaded: (asset: MediaAsset) => void
  onSaved: (note: AdminNote, pendingCleanupCount: number, action?: SaveActionKind) => void
  onDeleted: (noteId: string, pendingCleanupCount: number) => void
  onPreview: (draft: NotePayload & { id: string; publishedAt?: string | null }) => void
  onConflict: (conflict: ConflictContext) => void
  onClose: () => void
}) {
  const { locale, tr } = useI18n()
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const uid = useId()
  const [current, setCurrent] = useState<AdminNote | null>(initialNote)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [projectId, setProjectId] = useState<string>('')
  const [imageAssetIds, setImageAssetIds] = useState<string[]>([])
  const [videoAssetId, setVideoAssetId] = useState<string | null>(null)

  const [uploadBusy, setUploadBusy] = useState(false)
  const busyPickersRef = useRef<Set<string>>(new Set())
  const setPickerBusy = (key: string, busy: boolean) => {
    if (busy) busyPickersRef.current.add(key)
    else busyPickersRef.current.delete(key)
    setUploadBusy(busyPickersRef.current.size > 0)
  }
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const [saveError, setSaveError] = useState('')
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [preview, setPreview] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const prevNoteIdRef = useRef<string | null>(initialNote?.id ?? null)

  const sessionUploadedIdsRef = useRef<string[]>([])
  const wasOpenRef = useRef(false)

  function flushSessionCandidates() {
    const ids = sessionUploadedIdsRef.current
    sessionUploadedIdsRef.current = []
    if (ids.length > 0) {
      void cleanupMediaAssetsApi({ candidateAssetIds: ids }).catch(() => {
        // Unreferenced assets remain queued for cleanup retry.
      })
    }
  }

  function syncFromNote(note: AdminNote | null) {
    setCurrent(note)
    const draft = note?.draft
    setTitle(draft?.title ?? '')
    setBody(draft?.body ?? '')
    setProjectId(draft?.projectId ?? '')
    setImageAssetIds(draft?.imageAssetIds ?? [])
    setVideoAssetId(draft?.videoAssetId ?? null)
  }

  useEffect(() => {
    const opening = !wasOpenRef.current && open
    const closing = wasOpenRef.current && !open
    wasOpenRef.current = open
    if (closing) {
      setPreview(false)
      flushSessionCandidates()
      return
    }
    if (!open) return
    syncFromNote(initialNote)
    if (opening || (initialNote?.id ?? null) !== prevNoteIdRef.current) {
      prevNoteIdRef.current = initialNote?.id ?? null
      setPreview(false)
    }
    if (opening) {
      setSaveStatus('')
      setSaveError('')
      setDeleteError('')
      setConfirmDeleteOpen(false)
      sessionUploadedIdsRef.current = []
    }
  }, [open, initialNote?.id, initialNote?.version, initialNote?.updatedAt])

  useEffect(() => () => flushSessionCandidates(), [])

  function buildDraftPayload(): NotePayload {
    return {
      title: title.trim(),
      body: body.trim(),
      projectId: projectId.trim() ? projectId.trim() : null,
      imageAssetIds: imageAssetIds.filter((id) => Boolean(id)),
      videoAssetId,
    }
  }

  function validateForPublish(draft: NotePayload): string | null {
    if (uploadBusy) {
      return tr(
        '尚有图片或视频正在上传中，请等待完成或先取消上传后再发布。',
        'Images or video are still uploading—wait or cancel before publishing.',
      )
    }
    const missing: string[] = []
    if (!draft.title) missing.push(tr('手记标题', 'Title'))
    if (!draft.body) missing.push(tr('手记正文', 'Body'))
    if (missing.length > 0) {
      return locale === 'en'
        ? `Before publishing, please complete: ${missing.join(', ')}.`
        : `发布前请补全必填信息：${missing.join('、')}。`
    }
    const referenced = [...draft.imageAssetIds, draft.videoAssetId].filter((id): id is string =>
      Boolean(id),
    )
    const unready = referenced.filter((id) => assets[id] && assets[id].status !== 'ready')
    if (unready.length > 0) {
      return tr('部分图片或视频尚未上传就绪，请等待上传完成后再发布。', 'Some media files are still processing—please wait before publishing.')
    }
    return null
  }

  function raiseNoteConflict(err: ConflictError<AdminNote>) {
    const latest = err.latest
    if (!latest) {
      setSaveError(err.message)
      return
    }
    onConflict({
      title: title.trim() || current?.draft.title || tr('创作手记', 'Study Note'),
      localCopyText: `${tr('标题：', 'Title: ')}${title}\n\n${body}`,
      cloudSummaryLines: [
        `${tr('云端标题：', 'Latest title: ')}${latest.draft.title || tr('（空）', '(empty)')}`,
        `${tr('云端状态：', 'Status: ')}${buildStatusLabel(latest, locale)} · v${latest.version}`,
        `${tr('正文摘要：', 'Excerpt: ')}${latest.draft.body.slice(0, 160) || tr('（空）', '(empty)')}`,
      ],
      onUseCloud: () => {
        if (!alive.current) return
        syncFromNote(latest)
        onSaved(latest, 0)
        setSaveError('')
        setSaveStatus(tr('已载入云端最新版本。', 'Loaded latest version.'))
      },
    })
  }

  async function saveDraftInternal(notifyAction?: SaveActionKind): Promise<AdminNote | null> {
    if (uploadBusy) {
      setSaveError(
        tr(
          '尚有图片或视频正在上传中，请等待完成或先取消上传后再保存。',
          'Images or video are still uploading—wait or cancel before saving.',
        ),
      )
      return null
    }
    const draft = buildDraftPayload()
    const res = await saveNoteDraftApi(current?.id ?? null, current?.version ?? 0, draft)
    if (!alive.current) return null
    if (res.item) {
      setCurrent(res.item)
      onSaved(res.item, res.pendingCleanupCount, notifyAction)
      return res.item
    }
    return null
  }

  async function handleSaveDraft() {
    setSaving(true)
    setSaveError('')
    setSaveStatus('')
    try {
      const saved = await saveDraftInternal('draft')
      if (saved) {
        setSaveStatus(
          isCloudConfigured
            ? tr('手记草稿已保存到云端。', 'Note draft saved to cloud.')
            : tr('手记草稿已保存到本机。', 'Note draft saved locally.'),
        )
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        raiseNoteConflict(err as ConflictError<AdminNote>)
      } else {
        setSaveError(err instanceof Error ? err.message : tr('保存草稿失败，你的输入已保留。', 'Failed to save draft; your edits are preserved.'))
      }
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    const draft = buildDraftPayload()
    const validationError = validateForPublish(draft)
    if (validationError) {
      setSaveError(validationError)
      return
    }
    const wasPublished = Boolean(current?.isPublished)
    setSaving(true)
    setSaveError('')
    setSaveStatus('')
    try {
      const saved = await saveDraftInternal()
      if (!saved) return
      const pubRes = await publishNoteApi(saved.id, saved.version)
      if (!alive.current) return
      if (pubRes.item) {
        setCurrent(pubRes.item)
        onSaved(pubRes.item, pubRes.pendingCleanupCount, 'publish')
        setSaveStatus(
          wasPublished
            ? tr('手记更新已发布。', 'Note update published.')
            : tr('手记已发布到创作手记。', 'Note published to Study Notes.'),
        )
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        raiseNoteConflict(err as ConflictError<AdminNote>)
      } else {
        setSaveError(err instanceof Error ? err.message : tr('发布失败，草稿输入已保留。', 'Publish failed; draft edits are preserved.'))
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleUnpublish() {
    if (!current) return
    setSaving(true)
    setSaveError('')
    setSaveStatus('')
    try {
      const res = await unpublishNoteApi(current.id, current.version)
      if (!alive.current) return
      if (res.item) {
        setCurrent(res.item)
        onSaved(res.item, res.pendingCleanupCount, 'unpublish')
        setSaveStatus(tr('已撤回发布，草稿内容仍已保留。', 'Unpublished; your draft is kept safely.'))
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        raiseNoteConflict(err as ConflictError<AdminNote>)
      } else {
        setSaveError(err instanceof Error ? err.message : tr('撤回发布失败，请重试。', 'Failed to unpublish, please retry.'))
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirmDelete() {
    if (!current) return
    setSaving(true)
    setDeleteError('')
    try {
      const res = await deleteNoteApi(current.id, current.version)
      if (!alive.current) return
      setConfirmDeleteOpen(false)
      onDeleted(current.id, res.pendingCleanupCount)
      onClose()
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        setConfirmDeleteOpen(false)
        raiseNoteConflict(err as ConflictError<AdminNote>)
      } else {
        setDeleteError(err instanceof Error ? err.message : tr('删除失败，请重试。', 'Delete failed, please retry.'))
      }
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    alive.current = false
    flushSessionCandidates()
    onClose()
  }

  return (
    <>
      <Modal
        open={open}
        close={handleClose}
        label={current ? tr('编辑手记', 'Edit Study Note') : tr('写手记', 'Write Study Note')}
        className="cms-editor-dialog"
      >
        <div className="detail-meta-row">
          <span className="detail-kind-tag">{tr('创作手记管理', 'Study Notes Studio')}</span>
          <span className={`status-badge ${current?.isPublished ? 'live' : 'draft'}`}>
            {current ? `${buildStatusLabel(current, locale)} · v${current.version}` : tr('新建草稿', 'New Draft')}
          </span>
        </div>

        <h2>{current ? tr('编辑创作手记', 'Edit Study Note') : tr('撰写新创作手记', 'Write New Study Note')}</h2>
        <p className="dialog-intro">
          {tr(
            '记录设计判断、调优过程与取舍；保存草稿不会影响访客当前看到的内容。',
            'Document design rationale, experiments, and tradeoffs; saving drafts never alters the public view.',
          )}
        </p>

        <div className="cms-editor-columns">
          <div className="cms-editor-main cms-form-grid">
            <div className="cms-field">
              <div className="cms-field-head">
                <label htmlFor={`${uid}-title`}>{tr('手记标题（发布必填）', 'Title (required to publish)')}</label>
                <span className="cms-char-count">{title.length} {tr('字', 'chars')}</span>
              </div>
              <input
                id={`${uid}-title`}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={tr('例如：空间与浏览路线', 'e.g. Architecture & Corridor Flow')}
              />
            </div>

            <div className="cms-field">
              <div className="cms-field-head">
                <label htmlFor={`${uid}-project`}>{tr('关联作品（可选）', 'Linked Project (optional)')}</label>
              </div>
              <select
                id={`${uid}-project`}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">{tr('不关联具体作品', 'No linked project')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.draft.title || tr('未命名作品', 'Untitled Project')}
                    {p.isPublished ? '' : tr('（草稿）', ' (Draft)')}
                  </option>
                ))}
              </select>
            </div>

            <div className="cms-field">
              <div className="cms-field-head">
                <label htmlFor={`${uid}-body`}>{tr('手记正文（发布必填）', 'Body (required to publish)')}</label>
                <span className="cms-char-count">{body.replace(/\s+/g, '').length} {tr('字', 'chars')}</span>
              </div>
              <MarkdownToolbar
                textareaRef={bodyRef}
                value={body}
                onChange={setBody}
                preview={preview}
                onTogglePreview={() => setPreview((v) => !v)}
                disabled={saving}
              />
              {preview ? (
                <div className="markdown-preview-box detail-body">
                  {body.trim() ? (
                    renderParagraphs(body)
                  ) : (
                    <p className="cms-char-count">{tr('暂无正文内容，点击「返回编辑」开始输入。', 'Nothing written yet—click Edit to start typing.')}</p>
                  )}
                </div>
              ) : (
                <textarea
                  ref={bodyRef}
                  id={`${uid}-body`}
                  rows={10}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={tr('写下思考过程、对比尝试、依据与结论…', 'Write your thinking, tradeoffs, and conclusions…')}
                />
              )}
            </div>
          </div>

          <div className="cms-editor-media cms-form-grid">
            <ImageListPicker
              label={tr('过程附图（可选）', 'Process Images (optional)')}
              hint={tr('支持 JPEG / PNG / WebP，单张上限 10 MB；上传前自动调整尺寸', 'JPEG / PNG / WebP up to 10 MB; auto-resized before upload')}
              assetIds={imageAssetIds}
              multiple={true}
              disabled={saving}
              onChange={setImageAssetIds}
              onAssetUploaded={(asset) => {
                sessionUploadedIdsRef.current.push(asset.id)
                onAssetUploaded(asset)
              }}
              onUploadStateChange={(busy) => setPickerBusy('images', busy)}
            />

            <VideoUploadPicker
              videoAssetId={videoAssetId}
              assetInfo={videoAssetId ? assets[videoAssetId] : null}
              disabled={saving}
              onChange={setVideoAssetId}
              onAssetUploaded={(asset) => {
                sessionUploadedIdsRef.current.push(asset.id)
                onAssetUploaded(asset)
              }}
              onUploadStateChange={(busy) => setPickerBusy('video', busy)}
            />
          </div>
        </div>

        {saveStatus && (
          <p className="cms-status-banner" role="status">
            {tr('保存状态：', 'Status: ')}{saveStatus}
          </p>
        )}
        {saveError && (
          <p className="cms-error-banner" role="alert">
            {tr('保存状态：', 'Status: ')}{saveError}
          </p>
        )}

        <div className="editor-actions-bar">
          <div className="editor-actions-left">
            <button
              type="button"
              className="cms-ghost-btn"
              disabled={saving}
              onClick={() =>
                onPreview({
                  id: current?.id ?? 'preview-note',
                  publishedAt: current?.publishedAt ?? null,
                  ...buildDraftPayload(),
                })
              }
            >
              <Icon name="eye" size={15} />
              <span>{tr('预览当前草稿', 'Preview Draft')}</span>
            </button>

            {current?.isPublished && (
              <button
                type="button"
                className="cms-ghost-btn"
                disabled={saving || uploadBusy}
                onClick={() => void handleUnpublish()}
              >
                {tr('撤回发布', 'Unpublish')}
              </button>
            )}

            {current && (
              <button
                type="button"
                className="cms-danger-btn"
                disabled={saving || uploadBusy}
                onClick={() => {
                  setDeleteError('')
                  setConfirmDeleteOpen(true)
                }}
              >
                <Icon name="trash" size={15} />
                <span>{tr('删除', 'Delete')}</span>
              </button>
            )}
          </div>

          <div className="editor-actions-right">
            <button
              type="button"
              className="cms-ghost-btn"
              disabled={saving || uploadBusy}
              onClick={() => void handleSaveDraft()}
            >
              {saving ? tr('保存中…', 'Saving…') : tr('保存草稿', 'Save Draft')}
            </button>
            <button
              type="button"
              className="cms-primary-btn"
              disabled={saving || uploadBusy}
              onClick={() => void handlePublish()}
            >
              {saving ? tr('处理中…', 'Publishing…') : current?.isPublished ? tr('发布更新', 'Publish Update') : tr('发布手记', 'Publish Note')}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={tr('确认删除这篇手记？', 'Delete this study note?')}
        message={tr(
          `将删除手记「${current?.draft.title || '未命名手记'}」的草稿与公开版本；不再被其他内容引用的图片和视频会被清理，操作不可恢复。`,
          `This permanently deletes "${current?.draft.title || 'Untitled Note'}" (draft and published). Unused media will also be cleaned up.`,
        )}
        busy={saving}
        error={deleteError}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  )
}
