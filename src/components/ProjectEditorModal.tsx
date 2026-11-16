import { useEffect, useId, useRef, useState } from 'react'
import {
  cleanupMediaAssetsApi,
  deleteProjectApi,
  publishProjectApi,
  saveProjectDraftApi,
  unpublishProjectApi,
} from '../lib/api'
import { buildStatusLabel, safeExternalUrl } from '../lib/text'
import { isCloudConfigured } from '../lib/supabase'
import {
  ConflictError,
  type AdminProject,
  type MediaAsset,
  type ProjectPayload,
} from '../types/content'
import { ConfirmDialog } from './ConfirmDialog'
import type { ConflictContext } from './ConflictDialog'
import { Icon } from './Icon'
import { ImageListPicker, VideoUploadPicker } from './MediaPickers'
import { Modal } from './Modal'

export type SaveActionKind = 'draft' | 'publish' | 'unpublish'

export function ProjectEditorModal({
  open,
  initialProject,
  assets,
  onAssetUploaded,
  onSaved,
  onDeleted,
  onPreview,
  onConflict,
  onClose,
}: {
  open: boolean
  initialProject: AdminProject | null
  assets: Record<string, MediaAsset>
  onAssetUploaded: (asset: MediaAsset) => void
  onSaved: (project: AdminProject, pendingCleanupCount: number, action?: SaveActionKind) => void
  onDeleted: (projectId: string, pendingCleanupCount: number) => void
  onPreview: (draft: ProjectPayload & { id: string; publishedAt?: string | null }) => void
  onConflict: (conflict: ConflictContext) => void
  onClose: () => void
}) {
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const uid = useId()
  const [current, setCurrent] = useState<AdminProject | null>(initialProject)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const [demoUrl, setDemoUrl] = useState('')
  const [coverAssetId, setCoverAssetId] = useState<string | null>(null)
  const [galleryAssetIds, setGalleryAssetIds] = useState<string[]>([])
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
        // Unreferenced uploaded assets are also picked up by periodic cleanup.
      })
    }
  }

  function syncFromProject(project: AdminProject | null) {
    setCurrent(project)
    const draft = project?.draft
    setTitle(draft?.title ?? '')
    setSummary(draft?.summary ?? '')
    setBody(draft?.body ?? '')
    setDemoUrl(draft?.demoUrl ?? '')
    setCoverAssetId(draft?.coverAssetId ?? null)
    setGalleryAssetIds(draft?.galleryAssetIds ?? [])
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
    syncFromProject(initialProject)
    if (opening) {
      setSaveStatus('')
      setSaveError('')
      setDeleteError('')
      setConfirmDeleteOpen(false)
      sessionUploadedIdsRef.current = []
    }
  }, [open, initialProject?.id, initialProject?.version, initialProject?.updatedAt])

  useEffect(() => () => flushSessionCandidates(), [])

  function buildDraftPayload(): ProjectPayload {
    return {
      title: title.trim(),
      summary: summary.trim(),
      body: body.trim(),
      demoUrl: demoUrl.trim(),
      coverAssetId,
      galleryAssetIds: galleryAssetIds.filter((id) => Boolean(id)),
      videoAssetId,
    }
  }

  function validateForSave(draft: ProjectPayload): string | null {
    if (uploadBusy) return '尚有图片或视频正在上传中，请等待完成或先取消上传后再保存。'
    if (draft.demoUrl && !safeExternalUrl(draft.demoUrl)) {
      return '访问链接格式无效，请以 http:// 或 https:// 开头。'
    }
    return null
  }

  function validateForPublish(draft: ProjectPayload): string | null {
    const baseErr = validateForSave(draft)
    if (baseErr) return baseErr
    const missing: string[] = []
    if (!draft.title) missing.push('作品标题')
    if (!draft.summary) missing.push('作品简介')
    if (!draft.body) missing.push('作品正文')
    if (!draft.coverAssetId) missing.push('封面图')
    if (missing.length > 0) {
      return `发布前请补全必填信息：${missing.join('、')}。`
    }
    const referenced = [draft.coverAssetId, ...draft.galleryAssetIds, draft.videoAssetId].filter(
      (id): id is string => Boolean(id),
    )
    const unready = referenced.filter((id) => assets[id] && assets[id].status !== 'ready')
    if (unready.length > 0) {
      return '部分素材尚未上传就绪，请等待上传完成后再发布。'
    }
    return null
  }

  function raiseProjectConflict(err: ConflictError<AdminProject>) {
    const latest = err.latest
    if (!latest) {
      setSaveError(err.message)
      return
    }
    const localDraft = buildDraftPayload()
    onConflict({
      title: localDraft.title || current?.draft.title || '作品编辑',
      localCopyText: [
        `标题：${title}`,
        `简介：${summary}`,
        `链接：${demoUrl}`,
        '',
        body,
      ].join('\n'),
      cloudSummaryLines: [
        `云端标题：${latest.draft.title || '（空）'}`,
        `云端状态：${buildStatusLabel(latest)} · 版本 v${latest.version}`,
        `云端简介：${latest.draft.summary || '（空）'}`,
        `正文摘要：${latest.draft.body.slice(0, 140) || '（空）'}`,
      ],
      onUseCloud: () => {
        if (!alive.current) return
        syncFromProject(latest)
        onSaved(latest, 0)
        setSaveError('')
        setSaveStatus('已载入云端最新版本。')
      },
    })
  }

  async function saveDraftInternal(notifyAction?: SaveActionKind): Promise<AdminProject | null> {
    const draft = buildDraftPayload()
    const errMsg = validateForSave(draft)
    if (errMsg) {
      setSaveError(errMsg)
      return null
    }

    const res = await saveProjectDraftApi(current?.id ?? null, current?.version ?? 0, draft)
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
            ? '草稿已保存到云端（访客仍只看到已发布版本）。'
            : '草稿已保存到本机（访客仍只看到已发布版本）。',
        )
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        raiseProjectConflict(err as ConflictError<AdminProject>)
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
      const pubRes = await publishProjectApi(saved.id, saved.version)
      if (!alive.current) return
      if (pubRes.item) {
        setCurrent(pubRes.item)
        onSaved(pubRes.item, pubRes.pendingCleanupCount, 'publish')
        setSaveStatus(
          wasPublished ? '已发布更新，访客目录与三维展示已同步。' : '作品已发布到作品室。',
        )
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        raiseProjectConflict(err as ConflictError<AdminProject>)
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
      const res = await unpublishProjectApi(current.id, current.version)
      if (!alive.current) return
      if (res.item) {
        setCurrent(res.item)
        onSaved(res.item, res.pendingCleanupCount, 'unpublish')
        setSaveStatus('已撤回发布，访客不再看到此作品；草稿内容仍已保留。')
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        raiseProjectConflict(err as ConflictError<AdminProject>)
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
      const res = await deleteProjectApi(current.id, current.version)
      if (!alive.current) return
      setConfirmDeleteOpen(false)
      onDeleted(current.id, res.pendingCleanupCount)
      onClose()
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        setConfirmDeleteOpen(false)
        raiseProjectConflict(err as ConflictError<AdminProject>)
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
        label={current ? '编辑作品' : '添加作品'}
        className="cms-editor-dialog"
      >
        <div className="detail-meta-row">
          <span className="detail-kind-tag">作品室管理</span>
          <span className={`status-badge ${current?.isPublished ? 'live' : 'draft'}`}>
            {current ? `${buildStatusLabel(current)} · v${current.version}` : '新建草稿'}
          </span>
        </div>

        <h2>{current ? '编辑作品' : '添加新作品'}</h2>
        <p className="dialog-intro">
          {current?.isPublished
            ? '保存草稿仅更新修改草稿，访客继续查看已发布版本；点击“发布更新”后对外生效。'
            : '新建作品默认为草稿，预览确认后再点击发布。'}
        </p>

        <div className="cms-editor-columns">
          <div className="cms-editor-main cms-form-grid">
            <div className="cms-field">
              <div className="cms-field-head">
                <label htmlFor={`${uid}-title`}>作品标题（发布必填）</label>
                <span className="cms-char-count">{title.length} 字</span>
              </div>
              <input
                id={`${uid}-title`}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：我的小屋 · 交互式个人网站"
              />
            </div>

            <div className="cms-field">
              <div className="cms-field-head">
                <label htmlFor={`${uid}-summary`}>作品简介（发布必填）</label>
                <span className="cms-char-count">{summary.length} 字</span>
              </div>
              <textarea
                id={`${uid}-summary`}
                rows={2}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="一句话概括作品定位、特点与完成效果"
              />
            </div>

            <div className="cms-field">
              <div className="cms-field-head">
                <label htmlFor={`${uid}-url`}>访问链接（可选）</label>
              </div>
              <input
                id={`${uid}-url`}
                type="url"
                value={demoUrl}
                onChange={(e) => setDemoUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>

            <div className="cms-field">
              <div className="cms-field-head">
                <label htmlFor={`${uid}-body`}>作品正文（发布必填，支持分段纯文本）</label>
                <span className="cms-char-count">{body.replace(/\s+/g, '').length} 字</span>
              </div>
              <textarea
                id={`${uid}-body`}
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="介绍完成效果、空间设计与交互亮点…"
              />
            </div>
          </div>

          <div className="cms-editor-media cms-form-grid">
            <ImageListPicker
              label="作品封面图（发布必填）"
              hint="用于三维画框展示与作品封面；JPEG / PNG / WebP，单张上限 10 MB"
              assetIds={coverAssetId ? [coverAssetId] : []}
              multiple={false}
              disabled={saving}
              onChange={(ids) => setCoverAssetId(ids[0] ?? null)}
              onAssetUploaded={(asset) => {
                sessionUploadedIdsRef.current.push(asset.id)
                onAssetUploaded(asset)
              }}
              onUploadStateChange={(busy) => setPickerBusy('cover', busy)}
            />

            <ImageListPicker
              label="详情展示截图（可选）"
              hint="展示庭院、厅堂、房间与手机端截图；自动压缩并生成展示图与缩略图"
              assetIds={galleryAssetIds}
              multiple={true}
              disabled={saving}
              onChange={setGalleryAssetIds}
              onAssetUploaded={(asset) => {
                sessionUploadedIdsRef.current.push(asset.id)
                onAssetUploaded(asset)
              }}
              onUploadStateChange={(busy) => setPickerBusy('gallery', busy)}
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
                  id: current?.id ?? 'preview-draft',
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
              {saving ? '处理中…' : current?.isPublished ? '发布更新' : '发布作品'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="确认删除这件作品？"
        message={`将删除作品「${current?.draft.title || '未命名作品'}」的草稿与公开记录；不再被其他内容引用的图片和视频也会一并清理，操作不可恢复。`}
        busy={saving}
        error={deleteError}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  )
}
