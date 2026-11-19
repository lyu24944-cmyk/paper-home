import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import {
  cleanupMediaAssetsApi,
  deleteProjectApi,
  publishProjectApi,
  saveProjectDraftApi,
  unpublishProjectApi,
} from '../lib/api'
import { buildStatusLabel, renderParagraphs, safeExternalUrl } from '../lib/text'
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
import { MarkdownToolbar } from './MarkdownToolbar'
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
  const { locale, tr } = useI18n()
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
  const [preview, setPreview] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const prevProjectIdRef = useRef<string | null>(initialProject?.id ?? null)

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
      setPreview(false)
      flushSessionCandidates()
      return
    }
    if (!open) return
    syncFromProject(initialProject)
    if (opening || (initialProject?.id ?? null) !== prevProjectIdRef.current) {
      prevProjectIdRef.current = initialProject?.id ?? null
      setPreview(false)
    }
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
    if (uploadBusy) {
      return tr(
        '尚有图片或视频正在上传中，请等待完成或先取消上传后再保存。',
        'Images or video are still uploading—wait for completion or cancel them before saving.',
      )
    }
    if (draft.demoUrl && !safeExternalUrl(draft.demoUrl)) {
      return tr('访问链接格式无效，请以 http:// 或 https:// 开头。', 'Demo URL must start with http:// or https://.')
    }
    return null
  }

  function validateForPublish(draft: ProjectPayload): string | null {
    const baseErr = validateForSave(draft)
    if (baseErr) return baseErr
    const missing: string[] = []
    if (!draft.title) missing.push(tr('作品标题', 'Title'))
    if (!draft.summary) missing.push(tr('作品简介', 'Summary'))
    if (!draft.body) missing.push(tr('作品正文', 'Body'))
    if (!draft.coverAssetId) missing.push(tr('封面图', 'Cover Image'))
    if (missing.length > 0) {
      return locale === 'en'
        ? `Before publishing, please complete: ${missing.join(', ')}.`
        : `发布前请补全必填信息：${missing.join('、')}。`
    }
    const referenced = [draft.coverAssetId, ...draft.galleryAssetIds, draft.videoAssetId].filter(
      (id): id is string => Boolean(id),
    )
    const unready = referenced.filter((id) => assets[id] && assets[id].status !== 'ready')
    if (unready.length > 0) {
      return tr('部分素材尚未上传就绪，请等待上传完成后再发布。', 'Some media files are still processing—please wait before publishing.')
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
      title: localDraft.title || current?.draft.title || tr('作品编辑', 'Project Editor'),
      localCopyText: [
        `${tr('标题：', 'Title: ')}${title}`,
        `${tr('简介：', 'Summary: ')}${summary}`,
        `${tr('链接：', 'Link: ')}${demoUrl}`,
        '',
        body,
      ].join('\n'),
      cloudSummaryLines: [
        `${tr('云端标题：', 'Latest title: ')}${latest.draft.title || tr('（空）', '(empty)')}`,
        `${tr('云端状态：', 'Status: ')}${buildStatusLabel(latest, locale)} · v${latest.version}`,
        `${tr('云端简介：', 'Summary: ')}${latest.draft.summary || tr('（空）', '(empty)')}`,
        `${tr('正文摘要：', 'Excerpt: ')}${latest.draft.body.slice(0, 140) || tr('（空）', '(empty)')}`,
      ],
      onUseCloud: () => {
        if (!alive.current) return
        syncFromProject(latest)
        onSaved(latest, 0)
        setSaveError('')
        setSaveStatus(tr('已载入云端最新版本。', 'Loaded latest version.'))
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
            ? tr('草稿已保存到云端（访客仍只看到已发布版本）。', 'Draft saved to cloud (visitors still see the published version).')
            : tr('草稿已保存到本机（访客仍只看到已发布版本）。', 'Draft saved locally (visitors still see the published version).'),
        )
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        raiseProjectConflict(err as ConflictError<AdminProject>)
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
      const pubRes = await publishProjectApi(saved.id, saved.version)
      if (!alive.current) return
      if (pubRes.item) {
        setCurrent(pubRes.item)
        onSaved(pubRes.item, pubRes.pendingCleanupCount, 'publish')
        setSaveStatus(
          wasPublished
            ? tr('已发布更新，访客目录与三维展示已同步。', 'Published update—directory & 3D gallery synced.')
            : tr('作品已发布到作品室。', 'Project published to Gallery.'),
        )
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        raiseProjectConflict(err as ConflictError<AdminProject>)
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
      const res = await unpublishProjectApi(current.id, current.version)
      if (!alive.current) return
      if (res.item) {
        setCurrent(res.item)
        onSaved(res.item, res.pendingCleanupCount, 'unpublish')
        setSaveStatus(
          tr(
            '已撤回发布，访客不再看到此作品；草稿内容仍已保留。',
            'Unpublished from public view; your draft is kept safely.',
          ),
        )
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        raiseProjectConflict(err as ConflictError<AdminProject>)
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
        label={current ? tr('编辑作品', 'Edit Project') : tr('添加作品', 'Add Project')}
        className="cms-editor-dialog"
      >
        <div className="detail-meta-row">
          <span className="detail-kind-tag">{tr('作品室管理', 'Gallery Studio')}</span>
          <span className={`status-badge ${current?.isPublished ? 'live' : 'draft'}`}>
            {current ? `${buildStatusLabel(current, locale)} · v${current.version}` : tr('新建草稿', 'New Draft')}
          </span>
        </div>

        <h2>{current ? tr('编辑作品', 'Edit Project') : tr('添加新作品', 'Add New Project')}</h2>
        <p className="dialog-intro">
          {current?.isPublished
            ? tr(
                '保存草稿仅更新修改草稿，访客继续查看已发布版本；点击“发布更新”后对外生效。',
                'Saving a draft updates only your working copy; click "Publish Update" to go live.',
              )
            : tr(
                '新建作品默认为草稿，预览确认后再点击发布。',
                'New projects start as drafts—preview and publish when ready.',
              )}
        </p>

        <div className="cms-editor-columns">
          <div className="cms-editor-main cms-form-grid">
            <div className="cms-field">
              <div className="cms-field-head">
                <label htmlFor={`${uid}-title`}>{tr('作品标题（发布必填）', 'Title (required to publish)')}</label>
                <span className="cms-char-count">{title.length} {tr('字', 'chars')}</span>
              </div>
              <input
                id={`${uid}-title`}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={tr('例如：我的小屋 · 交互式个人网站', 'e.g. Paper Home · Interactive 3D Cottage')}
              />
            </div>

            <div className="cms-field">
              <div className="cms-field-head">
                <label htmlFor={`${uid}-summary`}>{tr('作品简介（发布必填）', 'Summary (required to publish)')}</label>
                <span className="cms-char-count">{summary.length} {tr('字', 'chars')}</span>
              </div>
              <textarea
                id={`${uid}-summary`}
                rows={2}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder={tr('一句话概括作品定位、特点与完成效果', 'A concise one-line summary of the project')}
              />
            </div>

            <div className="cms-field">
              <div className="cms-field-head">
                <label htmlFor={`${uid}-url`}>{tr('访问链接（可选）', 'Demo / Project URL (optional)')}</label>
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
                <label htmlFor={`${uid}-body`}>{tr('作品正文（发布必填，支持分段纯文本）', 'Body (required to publish, Markdown supported)')}</label>
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
                  rows={8}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={tr('介绍完成效果、空间设计与交互亮点…', 'Describe the outcome, craft details, and interactions…')}
                />
              )}
            </div>
          </div>

          <div className="cms-editor-media cms-form-grid">
            <ImageListPicker
              label={tr('作品封面图（发布必填）', 'Cover Image (required to publish)')}
              hint={tr('用于三维画框展示与作品封面；JPEG / PNG / WebP，单张上限 10 MB', 'Shown in the 3D gallery frames & list; JPEG / PNG / WebP up to 10 MB')}
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
              label={tr('详情展示截图（可选）', 'Gallery Screenshots (optional)')}
              hint={tr('展示庭院、厅堂、房间与手机端截图；自动压缩并生成展示图与缩略图', 'Additional views & screenshots; auto-resized for display and thumbnails')}
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
                  id: current?.id ?? 'preview-draft',
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
              {saving ? tr('处理中…', 'Publishing…') : current?.isPublished ? tr('发布更新', 'Publish Update') : tr('发布作品', 'Publish Project')}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={tr('确认删除这件作品？', 'Delete this project?')}
        message={tr(
          `将删除作品「${current?.draft.title || '未命名作品'}」的草稿与公开记录；不再被其他内容引用的图片和视频也会一并清理，操作不可恢复。`,
          `This permanently deletes "${current?.draft.title || 'Untitled Project'}" (draft and published). Unused images/videos will also be queued for cleanup.`,
        )}
        busy={saving}
        error={deleteError}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  )
}
