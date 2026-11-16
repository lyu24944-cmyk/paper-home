import { useEffect, useId, useRef, useState } from 'react'
import {
  cleanupMediaAssetsApi,
  deleteNoteApi,
  publishNoteApi,
  saveNoteDraftApi,
  unpublishNoteApi,
} from '../lib/api'
import { buildStatusLabel } from '../lib/text'
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
      flushSessionCandidates()
      return
    }
    if (!open) return
    syncFromNote(initialNote)
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
    if (uploadBusy) return '尚有图片或视频正在上传中，请等待完成或先取消上传后再发布。'
    const missing: string[] = []
    if (!draft.title) missing.push('手记标题')
    if (!draft.body) missing.push('手记正文')
    if (missing.length > 0) {
      return `发布前请补全必填信息：${missing.join('、')}。`
    }
    const referenced = [...draft.imageAssetIds, draft.videoAssetId].filter((id): id is string =>
      Boolean(id),
    )
    const unready = referenced.filter((id) => assets[id] && assets[id].status !== 'ready')
    if (unready.length > 0) {
      return '部分图片或视频尚未上传就绪，请等待上传完成后再发布。'
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
      title: title.trim() || current?.draft.title || '创作手记',
      localCopyText: `标题：${title}\n\n${body}`,
      cloudSummaryLines: [
        `云端标题：${latest.draft.title || '（空）'}`,
        `云端状态：${buildStatusLabel(latest)} · 版本 v${latest.version}`,
        `正文摘要：${latest.draft.body.slice(0, 160) || '（空）'}`,
      ],
      onUseCloud: () => {
        if (!alive.current) return
        syncFromNote(latest)
        onSaved(latest, 0)
        setSaveError('')
        setSaveStatus('已载入云端最新版本。')
      },
    })
  }

  async function saveDraftInternal(notifyAction?: SaveActionKind): Promise<AdminNote | null> {
    if (uploadBusy) {
      setSaveError('尚有图片或视频正在上传中，请等待完成或先取消上传后再保存。')
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
        setSaveStatus(isCloudConfigured ? '手记草稿已保存到云端。' : '手记草稿已保存到本机。')
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        raiseNoteConflict(err as ConflictError<AdminNote>)
      } else {
        setSaveError(err instanceof Error ? err.message : '保存草稿失败，你的输入已保留。')
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
        setSaveStatus(wasPublished ? '手记更新已发布。' : '手记已发布到创作手记。')
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        raiseNoteConflict(err as ConflictError<AdminNote>)
      } else {
        setSaveError(err instanceof Error ? err.message : '发布失败，草稿输入已保留。')
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
        setSaveStatus('已撤回发布，草稿内容仍已保留。')
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        raiseNoteConflict(err as ConflictError<AdminNote>)
      } else {
        setSaveError(err instanceof Error ? err.message : '撤回发布失败，请重试。')
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
        setDeleteError(err instanceof Error ? err.message : '删除失败，请重试。')
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
        label={current ? '编辑手记' : '写手记'}
        className="cms-editor-dialog"
      >
        <div className="detail-meta-row">
          <span className="detail-kind-tag">创作手记管理</span>
          <span className={`status-badge ${current?.isPublished ? 'live' : 'draft'}`}>
            {current ? `${buildStatusLabel(current)} · v${current.version}` : '新建草稿'}
          </span>
        </div>

        <h2>{current ? '编辑创作手记' : '撰写新创作手记'}</h2>
        <p className="dialog-intro">
          记录设计判断、调优过程与取舍；保存草稿不会影响访客当前看到的内容。
        </p>

        <div className="cms-editor-columns">
          <div className="cms-editor-main cms-form-grid">
            <div className="cms-field">
              <div className="cms-field-head">
                <label htmlFor={`${uid}-title`}>手记标题（发布必填）</label>
                <span className="cms-char-count">{title.length} 字</span>
              </div>
              <input
                id={`${uid}-title`}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：空间与浏览路线"
              />
            </div>

            <div className="cms-field">
              <div className="cms-field-head">
                <label htmlFor={`${uid}-project`}>关联作品（可选）</label>
              </div>
              <select
                id={`${uid}-project`}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">不关联具体作品</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.draft.title || '未命名作品'}
                    {p.isPublished ? '' : '（草稿）'}
                  </option>
                ))}
              </select>
            </div>

            <div className="cms-field">
              <div className="cms-field-head">
                <label htmlFor={`${uid}-body`}>手记正文（发布必填）</label>
                <span className="cms-char-count">{body.replace(/\s+/g, '').length} 字</span>
              </div>
              <textarea
                id={`${uid}-body`}
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="写下思考过程、对比尝试、依据与结论…"
              />
            </div>
          </div>

          <div className="cms-editor-media cms-form-grid">
            <ImageListPicker
              label="过程附图（可选）"
              hint="支持 JPEG / PNG / WebP，单张上限 10 MB；上传前自动调整尺寸"
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
            保存状态：{saveStatus}
          </p>
        )}
        {saveError && (
          <p className="cms-error-banner" role="alert">
            保存状态：{saveError}
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
              <span>预览当前草稿</span>
            </button>

            {current?.isPublished && (
              <button
                type="button"
                className="cms-ghost-btn"
                disabled={saving || uploadBusy}
                onClick={() => void handleUnpublish()}
              >
                撤回发布
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
                <span>删除</span>
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
              {saving ? '保存中…' : '保存草稿'}
            </button>
            <button
              type="button"
              className="cms-primary-btn"
              disabled={saving || uploadBusy}
              onClick={() => void handlePublish()}
            >
              {saving ? '处理中…' : current?.isPublished ? '发布更新' : '发布手记'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="确认删除这篇手记？"
        message={`将删除手记「${current?.draft.title || '未命名手记'}」的草稿与公开版本；不再被其他内容引用的图片和视频会被清理，操作不可恢复。`}
        busy={saving}
        error={deleteError}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  )
}
