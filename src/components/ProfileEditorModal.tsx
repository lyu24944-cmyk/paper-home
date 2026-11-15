import { useEffect, useId, useRef, useState } from 'react'
import {
  cleanupMediaAssetsApi,
  publishProfileApi,
  saveProfileDraftApi,
  unpublishProfileApi,
} from '../lib/api'
import { buildStatusLabel, isValidEmail, renderParagraphs, safeExternalUrl } from '../lib/text'
import {
  ConflictError,
  type AdminProfile,
  type ContactLink,
  type MediaAsset,
  type ProfilePayload,
} from '../types/content'
import type { ConflictContext } from './ConflictDialog'
import { Icon } from './Icon'
import { ImageListPicker } from './MediaPickers'
import { Modal } from './Modal'
import type { SaveActionKind } from './ProjectEditorModal'
import { SignedImage } from './SignedImage'

export function ProfileEditorModal({
  open,
  initialProfile,
  assets,
  onAssetUploaded,
  onSaved,
  onConflict,
  onClose,
}: {
  open: boolean
  initialProfile: AdminProfile | null
  assets: Record<string, MediaAsset>
  onAssetUploaded: (asset: MediaAsset) => void
  onSaved: (profile: AdminProfile, pendingCleanupCount: number, action?: SaveActionKind) => void
  onConflict: (conflict: ConflictContext) => void
  onClose: () => void
}) {
  const uid = useId()
  const [current, setCurrent] = useState<AdminProfile | null>(initialProfile)
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [focusAreas, setFocusAreas] = useState('')
  const [avatarAssetId, setAvatarAssetId] = useState<string | null>(null)
  const [contactEmail, setContactEmail] = useState('')
  const [contactLinks, setContactLinks] = useState<ContactLink[]>([])
  const [nowNotes, setNowNotes] = useState<string[]>(['', '', ''])
  const [quotesText, setQuotesText] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)

  const [uploadBusy, setUploadBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const [saveError, setSaveError] = useState('')

  const sessionUploadedIdsRef = useRef<string[]>([])
  const wasOpenRef = useRef(false)

  function flushSessionCandidates() {
    const ids = sessionUploadedIdsRef.current
    sessionUploadedIdsRef.current = []
    if (ids.length > 0) {
      void cleanupMediaAssetsApi({ candidateAssetIds: ids }).catch(() => {
        // Unreferenced assets stay queued.
      })
    }
  }

  function syncFromProfile(profile: AdminProfile | null) {
    setCurrent(profile)
    const draft = profile?.draft
    setDisplayName(draft?.displayName ?? '')
    setBio(draft?.bio ?? '')
    setFocusAreas(draft?.focusAreas ?? '')
    setAvatarAssetId(draft?.avatarAssetId ?? null)
    setContactEmail(draft?.contactEmail ?? '')
    setContactLinks(draft?.contactLinks ? draft.contactLinks.map((l) => ({ ...l })) : [])
    const existingNow = Array.isArray(draft?.nowNotes) ? draft.nowNotes : []
    setNowNotes([existingNow[0] ?? '', existingNow[1] ?? '', existingNow[2] ?? ''])
    setQuotesText(Array.isArray(draft?.quotes) ? draft.quotes.join('\n') : '')
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
    syncFromProfile(initialProfile)
    if (opening) {
      setPreviewOpen(false)
      setSaveStatus('')
      setSaveError('')
      sessionUploadedIdsRef.current = []
    }
  }, [open, initialProfile?.version, initialProfile?.updatedAt])

  useEffect(() => () => flushSessionCandidates(), [])

  function buildDraftPayload(): ProfilePayload {
    return {
      displayName: displayName.trim(),
      bio: bio.trim(),
      focusAreas: focusAreas.trim(),
      avatarAssetId,
      contactEmail: contactEmail.trim(),
      contactLinks: contactLinks
        .map((item) => ({ label: item.label.trim(), url: item.url.trim() }))
        .filter((item) => item.label || item.url),
      nowNotes: nowNotes.map((n) => n.trim().slice(0, 36)).filter(Boolean).slice(0, 3),
      quotes: quotesText
        .split(/\r?\n/)
        .map((q) => q.trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 8),
    }
  }

  function validateDraft(draft: ProfilePayload, requireAnyField: boolean): string | null {
    if (uploadBusy) return '头像正在上传中，请等待完成后再操作。'
    if (draft.contactEmail && !isValidEmail(draft.contactEmail)) {
      return '公开联系邮箱格式无效，请检查后再试。'
    }
    for (const item of draft.contactLinks) {
      if (!item.label || !item.url) {
        return '联系方式链接请同时填写名称与网址，或删除空白行。'
      }
      if (!safeExternalUrl(item.url)) {
        return `链接「${item.label}」格式无效，请以 http:// 或 https:// 开头。`
      }
    }
    if (requireAnyField) {
      const hasAny =
        Boolean(draft.displayName) ||
        Boolean(draft.bio) ||
        Boolean(draft.focusAreas) ||
        Boolean(draft.avatarAssetId) ||
        Boolean(draft.contactEmail) ||
        draft.contactLinks.length > 0 ||
        (draft.nowNotes?.length ?? 0) > 0 ||
        (draft.quotes?.length ?? 0) > 0
      if (!hasAny) {
        return '请至少填写一项公开个人资料（昵称、介绍、关注方向、头像或联系方式）后再发布。'
      }
      if (
        draft.avatarAssetId &&
        assets[draft.avatarAssetId] &&
        assets[draft.avatarAssetId].status !== 'ready'
      ) {
        return '头像尚未上传就绪，请等待完成后再发布。'
      }
    }
    return null
  }

  function raiseProfileConflict(err: ConflictError<AdminProfile>) {
    const latest = err.latest
    if (!latest) {
      setSaveError(err.message)
      return
    }
    const cleanNow = nowNotes.map((n) => n.trim()).filter(Boolean)
    const cleanQuotes = quotesText
      .split(/\r?\n/)
      .map((q) => q.trim())
      .filter(Boolean)
    onConflict({
      title: '关于我',
      localCopyText: [
        `称呼：${displayName}`,
        `关注方向：${focusAreas}`,
        `公开联系邮箱：${contactEmail}`,
        ...contactLinks.map((l) => `${l.label}: ${l.url}`),
        ...(cleanNow.length ? ['', '近况便签：', ...cleanNow] : []),
        ...(cleanQuotes.length ? ['', '书桌灵感签：', ...cleanQuotes] : []),
        '',
        bio,
      ].join('\n'),
      cloudSummaryLines: [
        `云端称呼：${latest.draft.displayName || '（未填写）'}`,
        `云端状态：${buildStatusLabel(latest)} · 版本 v${latest.version}`,
        `关注方向：${latest.draft.focusAreas || '（未填写）'}`,
        `简介摘要：${latest.draft.bio.slice(0, 120) || '（未填写）'}`,
      ],
      onUseCloud: () => {
        syncFromProfile(latest)
        onSaved(latest, 0)
        setSaveError('')
        setSaveStatus('已载入云端最新个人资料。')
      },
    })
  }

  async function saveDraftInternal(notifyAction?: SaveActionKind): Promise<AdminProfile | null> {
    const draft = buildDraftPayload()
    const validationErr = validateDraft(draft, false)
    if (validationErr) {
      setSaveError(validationErr)
      return null
    }
    const res = await saveProfileDraftApi(current?.version ?? 1, draft)
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
        setSaveStatus('个人资料草稿已保存。')
      }
    } catch (err) {
      if (err instanceof ConflictError) {
        raiseProfileConflict(err as ConflictError<AdminProfile>)
      } else {
        setSaveError(err instanceof Error ? err.message : '保存草稿失败，输入内容已保留。')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    const draft = buildDraftPayload()
    const validationErr = validateDraft(draft, true)
    if (validationErr) {
      setSaveError(validationErr)
      return
    }
    setSaving(true)
    setSaveError('')
    setSaveStatus('')
    try {
      const saved = await saveDraftInternal()
      if (!saved) return
      const res = await publishProfileApi(saved.version)
      if (res.item) {
        setCurrent(res.item)
        onSaved(res.item, res.pendingCleanupCount, 'publish')
        setSaveStatus('“关于我”公开内容已更新。')
      }
    } catch (err) {
      if (err instanceof ConflictError) {
        raiseProfileConflict(err as ConflictError<AdminProfile>)
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
      const res = await unpublishProfileApi(current.version)
      if (res.item) {
        setCurrent(res.item)
        onSaved(res.item, res.pendingCleanupCount, 'unpublish')
        setSaveStatus('已撤回公开展示；未填写状态下访客将看到简洁的待完善提示。')
      }
    } catch (err) {
      if (err instanceof ConflictError) {
        raiseProfileConflict(err as ConflictError<AdminProfile>)
      } else {
        setSaveError(err instanceof Error ? err.message : '撤回失败，请重试。')
      }
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    flushSessionCandidates()
    onClose()
  }

  const previewDraft = buildDraftPayload()

  return (
    <Modal
      open={open}
      close={handleClose}
      label="编辑关于我"
      className="cms-editor-dialog"
    >
      <div className="detail-meta-row">
        <span className="detail-kind-tag">关于我</span>
        <span className={`status-badge ${current?.isPublished ? 'live' : 'draft'}`}>
          {current ? `${buildStatusLabel(current)} · v${current.version}` : '待完善'}
        </span>
      </div>

      <h2>编辑个人介绍</h2>
      <p className="dialog-intro">
        填写你想公开的称呼、个人介绍、关注方向与联系方式。空白字段不会公开展示；管理员登录邮箱默认与此处分开。
      </p>

      <div className="cms-editor-columns">
        <div className="cms-editor-main cms-form-grid">
          <div className="cms-field">
            <div className="cms-field-head">
              <label htmlFor={`${uid}-displayName`}>称呼 / 名字（可留空）</label>
              <span className="cms-char-count">{displayName.length} 字</span>
            </div>
            <input
              id={`${uid}-displayName`}
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例如：你的名字或网名"
            />
          </div>

          <div className="cms-field">
            <div className="cms-field-head">
              <label htmlFor={`${uid}-focusAreas`}>关注方向（可留空）</label>
              <span className="cms-char-count">{focusAreas.length} 字</span>
            </div>
            <input
              id={`${uid}-focusAreas`}
              type="text"
              value={focusAreas}
              onChange={(e) => setFocusAreas(e.target.value)}
              placeholder="例如：网页交互、空间设计、个人工具创作"
            />
          </div>

          <div className="cms-field">
            <div className="cms-field-head">
              <label htmlFor={`${uid}-bio`}>个人介绍（可留空）</label>
              <span className="cms-char-count">{bio.replace(/\s+/g, '').length} 字</span>
            </div>
            <textarea
              id={`${uid}-bio`}
              rows={6}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="简单介绍你是谁、正在做什么，未填写时不会编造经历…"
            />
          </div>

          <div className="cms-field">
            <div className="cms-field-head">
              <label htmlFor={`${uid}-now-0`}>桌面「近期在做 · Now」便签（可选，最多 3 张）</label>
              <span className="cms-char-count">同步展示在三维木桌</span>
            </div>
            <div className="now-notes-edit-list">
              {[0, 1, 2].map((idx) => (
                <input
                  key={idx}
                  id={`${uid}-now-${idx}`}
                  type="text"
                  maxLength={32}
                  value={nowNotes[idx] ?? ''}
                  onChange={(e) =>
                    setNowNotes((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))
                  }
                  placeholder={
                    idx === 0
                      ? '便签 01（例如：正在打磨四时天色与窗景）'
                      : idx === 1
                        ? '便签 02（例如：在读《建筑的模式语言》）'
                        : '便签 03（例如：周末去山里徒步收集声音）'
                  }
                />
              ))}
            </div>
          </div>

          <div className="cms-field">
            <div className="cms-field-head">
              <label htmlFor={`${uid}-quotes`}>书房书架灵感签（可选，每行一句，最多 8 句）</label>
              <span className="cms-char-count">点击书房书架随机抽取</span>
            </div>
            <textarea
              id={`${uid}-quotes`}
              rows={3}
              value={quotesText}
              onChange={(e) => setQuotesText(e.target.value)}
              placeholder="写下你喜欢的书摘或创作随想，访客点击书房书架时会抽出一张纸签…"
            />
          </div>
        </div>

        <div className="cms-editor-media cms-form-grid">
          <ImageListPicker
            label="个人头像（可选）"
            hint="支持 JPEG / PNG / WebP，单张上限 10 MB"
            assetIds={avatarAssetId ? [avatarAssetId] : []}
            multiple={false}
            disabled={saving}
            onChange={(ids) => setAvatarAssetId(ids[0] ?? null)}
            onAssetUploaded={(asset) => {
              sessionUploadedIdsRef.current.push(asset.id)
              onAssetUploaded(asset)
            }}
            onUploadStateChange={setUploadBusy}
          />

          <div className="cms-field">
            <div className="cms-field-head">
              <label htmlFor={`${uid}-email`}>公开联系邮箱（可选，独立于登录邮箱）</label>
            </div>
            <input
              id={`${uid}-email`}
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="希望对外显示的联系邮箱，不填则不公开"
            />
          </div>

          <div className="media-picker-block">
            <div className="media-picker-head">
              <div>
                <strong>更多联系方式 / 主页链接（可选）</strong>
                <small>例如 GitHub、作品集或博客</small>
              </div>
              <button
                type="button"
                className="cms-ghost-btn"
                disabled={saving}
                onClick={() => setContactLinks((prev) => [...prev, { label: '', url: '' }])}
              >
                <Icon name="plus" size={14} />
                <span>添加链接</span>
              </button>
            </div>
            {contactLinks.map((link, idx) => (
              <div key={idx} className="contact-link-edit-row">
                <input
                  type="text"
                  placeholder="名称（如 GitHub）"
                  value={link.label}
                  onChange={(e) =>
                    setContactLinks((prev) =>
                      prev.map((row, i) => (i === idx ? { ...row, label: e.target.value } : row)),
                    )
                  }
                />
                <input
                  type="url"
                  placeholder="https://..."
                  value={link.url}
                  onChange={(e) =>
                    setContactLinks((prev) =>
                      prev.map((row, i) => (i === idx ? { ...row, url: e.target.value } : row)),
                    )
                  }
                />
                <button
                  type="button"
                  className="cms-ghost-btn"
                  aria-label="删除链接"
                  onClick={() => setContactLinks((prev) => prev.filter((_, i) => i !== idx))}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {previewOpen && (
        <section className="cloud-preview-box" aria-label="草稿公开预览">
          <h3>当前草稿公开效果预览（空白字段自动隐藏）</h3>
          {previewDraft.avatarAssetId && (
            <SignedImage
              assetId={previewDraft.avatarAssetId}
              scope="admin"
              variant="thumb"
              alt="头像预览"
              className="profile-avatar-preview"
            />
          )}
          {previewDraft.displayName && <p><strong>{previewDraft.displayName}</strong></p>}
          {previewDraft.focusAreas && <p>关注方向：{previewDraft.focusAreas}</p>}
          {previewDraft.bio && <div>{renderParagraphs(previewDraft.bio)}</div>}
          {previewDraft.contactEmail && <p>联系邮箱：{previewDraft.contactEmail}</p>}
          {previewDraft.contactLinks.length > 0 && (
            <p>
              链接：
              {previewDraft.contactLinks.map((l) => `${l.label} (${l.url})`).join(' · ')}
            </p>
          )}
          {!previewDraft.displayName &&
            !previewDraft.bio &&
            !previewDraft.focusAreas &&
            !previewDraft.avatarAssetId &&
            !previewDraft.contactEmail &&
            previewDraft.contactLinks.length === 0 && (
              <p>个人介绍待完善——访客会看到简洁的待完善状态，不会展示占位经历。</p>
            )}
        </section>
      )}

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
            onClick={() => setPreviewOpen((v) => !v)}
          >
            <Icon name="eye" size={15} />
            <span>{previewOpen ? '收起预览' : '预览'}</span>
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
            {saving ? '处理中…' : current?.isPublished ? '发布更新' : '发布介绍'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
