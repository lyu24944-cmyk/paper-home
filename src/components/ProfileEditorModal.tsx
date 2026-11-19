import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
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
  const { locale, tr } = useI18n()
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
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
    if (uploadBusy) return tr('头像正在上传中，请等待完成后再操作。', 'Avatar is still uploading—please wait.')
    if (draft.contactEmail && !isValidEmail(draft.contactEmail)) {
      return tr('公开联系邮箱格式无效，请检查后再试。', 'Contact email format is invalid.')
    }
    for (const item of draft.contactLinks) {
      if (!item.label || !item.url) {
        return tr('联系方式链接请同时填写名称与网址，或删除空白行。', 'Each link needs both a label and a URL, or remove empty rows.')
      }
      if (!safeExternalUrl(item.url)) {
        return tr(
          `链接「${item.label}」格式无效，请以 http:// 或 https:// 开头。`,
          `Link "${item.label}" must start with http:// or https://.`,
        )
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
        return tr(
          '请至少填写一项公开个人资料（昵称、介绍、关注方向、头像或联系方式）后再发布。',
          'Fill in at least one public profile field before publishing.',
        )
      }
      if (
        draft.avatarAssetId &&
        assets[draft.avatarAssetId] &&
        assets[draft.avatarAssetId].status !== 'ready'
      ) {
        return tr('头像尚未上传就绪，请等待完成后再发布。', 'Avatar is still processing—please wait before publishing.')
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
      title: tr('关于我', 'About Me'),
      localCopyText: [
        `${tr('称呼：', 'Name: ')}${displayName}`,
        `${tr('关注方向：', 'Focus: ')}${focusAreas}`,
        `${tr('公开联系邮箱：', 'Public Email: ')}${contactEmail}`,
        ...contactLinks.map((l) => `${l.label}: ${l.url}`),
        ...(cleanNow.length ? ['', tr('近况便签：', 'Now Notes:'), ...cleanNow] : []),
        ...(cleanQuotes.length ? ['', tr('书桌灵感签：', 'Shelf Quotes:'), ...cleanQuotes] : []),
        '',
        bio,
      ].join('\n'),
      cloudSummaryLines: [
        `${tr('云端称呼：', 'Latest name: ')}${latest.draft.displayName || tr('（未填写）', '(empty)')}`,
        `${tr('云端状态：', 'Status: ')}${buildStatusLabel(latest, locale)} · v${latest.version}`,
        `${tr('关注方向：', 'Focus: ')}${latest.draft.focusAreas || tr('（未填写）', '(empty)')}`,
        `${tr('简介摘要：', 'Bio excerpt: ')}${latest.draft.bio.slice(0, 120) || tr('（未填写）', '(empty)')}`,
      ],
      onUseCloud: () => {
        if (!alive.current) return
        syncFromProfile(latest)
        onSaved(latest, 0)
        setSaveError('')
        setSaveStatus(tr('已载入云端最新个人资料。', 'Loaded latest profile.'))
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
        setSaveStatus(tr('个人资料草稿已保存。', 'Profile draft saved.'))
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        raiseProfileConflict(err as ConflictError<AdminProfile>)
      } else {
        setSaveError(err instanceof Error ? err.message : tr('保存草稿失败，输入内容已保留。', 'Failed to save draft; your edits are preserved.'))
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
      if (!alive.current) return
      if (res.item) {
        setCurrent(res.item)
        onSaved(res.item, res.pendingCleanupCount, 'publish')
        setSaveStatus(tr('“关于我”公开内容已更新。', 'Public About Me page updated.'))
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        raiseProfileConflict(err as ConflictError<AdminProfile>)
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
      const res = await unpublishProfileApi(current.version)
      if (!alive.current) return
      if (res.item) {
        setCurrent(res.item)
        onSaved(res.item, res.pendingCleanupCount, 'unpublish')
        setSaveStatus(
          tr(
            '已撤回公开展示；未填写状态下访客将看到简洁的待完善提示。',
            'Unpublished; visitors see a clean placeholder until published again.',
          ),
        )
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ConflictError) {
        raiseProfileConflict(err as ConflictError<AdminProfile>)
      } else {
        setSaveError(err instanceof Error ? err.message : tr('撤回失败，请重试。', 'Failed to unpublish, please retry.'))
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

  const previewDraft = buildDraftPayload()

  return (
    <Modal
      open={open}
      close={handleClose}
      label={tr('编辑关于我', 'Edit About Me')}
      className="cms-editor-dialog"
    >
      <div className="detail-meta-row">
        <span className="detail-kind-tag">{tr('关于我', 'About Me')}</span>
        <span className={`status-badge ${current?.isPublished ? 'live' : 'draft'}`}>
          {current ? `${buildStatusLabel(current, locale)} · v${current.version}` : tr('待完善', 'Not set')}
        </span>
      </div>

      <h2>{tr('编辑个人介绍', 'Edit Profile & Bio')}</h2>
      <p className="dialog-intro">
        {tr(
          '填写你想公开的称呼、个人介绍、关注方向与联系方式。空白字段不会公开展示；管理员登录邮箱默认与此处分开。',
          'Add your public name, bio, focus areas, and contact links. Blank fields stay hidden; owner sign-in email stays private.',
        )}
      </p>

      <div className="cms-editor-columns">
        <div className="cms-editor-main cms-form-grid">
          <div className="cms-field">
            <div className="cms-field-head">
              <label htmlFor={`${uid}-displayName`}>{tr('称呼 / 名字（可留空）', 'Display Name (optional)')}</label>
              <span className="cms-char-count">{displayName.length} {tr('字', 'chars')}</span>
            </div>
            <input
              id={`${uid}-displayName`}
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={tr('例如：你的名字或网名', 'e.g. Your name or handle')}
            />
          </div>

          <div className="cms-field">
            <div className="cms-field-head">
              <label htmlFor={`${uid}-focusAreas`}>{tr('关注方向（可留空）', 'Focus Areas (optional)')}</label>
              <span className="cms-char-count">{focusAreas.length} {tr('字', 'chars')}</span>
            </div>
            <input
              id={`${uid}-focusAreas`}
              type="text"
              value={focusAreas}
              onChange={(e) => setFocusAreas(e.target.value)}
              placeholder={tr('例如：网页交互、空间设计、个人工具创作', 'e.g. Interactive web, spatial design, indie tools')}
            />
          </div>

          <div className="cms-field">
            <div className="cms-field-head">
              <label htmlFor={`${uid}-bio`}>{tr('个人介绍（可留空）', 'Bio (optional)')}</label>
              <span className="cms-char-count">{bio.replace(/\s+/g, '').length} {tr('字', 'chars')}</span>
            </div>
            <textarea
              id={`${uid}-bio`}
              rows={6}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder={tr('简单介绍你是谁、正在做什么，未填写时不会编造经历…', 'Share who you are and what you build…')}
            />
          </div>

          <div className="cms-field">
            <div className="cms-field-head">
              <label htmlFor={`${uid}-now-0`}>{tr('桌面「近期在做 · Now」便签（可选，最多 3 张）', 'Tabletop "Now" Sticky Notes (optional, max 3)')}</label>
              <span className="cms-char-count">{tr('同步展示在三维木桌', 'Shown on the 3D table')}</span>
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
                      ? tr('便签 01（例如：正在打磨四时天色与窗景）', 'Note 01 (e.g. Refining courtyard light & rain)')
                      : idx === 1
                        ? tr('便签 02（例如：在读《建筑的模式语言》）', 'Note 02 (e.g. Reading A Pattern Language)')
                        : tr('便签 03（例如：周末去山里徒步收集声音）', 'Note 03 (e.g. Recording field audio outdoors)')
                  }
                />
              ))}
            </div>
          </div>

          <div className="cms-field">
            <div className="cms-field-head">
              <label htmlFor={`${uid}-quotes`}>{tr('书房书架灵感签（可选，每行一句，最多 8 句）', 'Study Shelf Inspiration Slips (optional, 1 per line, max 8)')}</label>
              <span className="cms-char-count">{tr('点击书房书架随机抽取', 'Drawn from the Study shelf')}</span>
            </div>
            <textarea
              id={`${uid}-quotes`}
              rows={3}
              value={quotesText}
              onChange={(e) => setQuotesText(e.target.value)}
              placeholder={tr('写下你喜欢的书摘或创作随想，访客点击书房书架时会抽出一张纸签…', 'Add favorite excerpts or notes—visitors draw one when clicking the bookshelf…')}
            />
          </div>
        </div>

        <div className="cms-editor-media cms-form-grid">
          <ImageListPicker
            label={tr('个人头像（可选）', 'Avatar Image (optional)')}
            hint={tr('支持 JPEG / PNG / WebP，单张上限 10 MB', 'JPEG / PNG / WebP up to 10 MB')}
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
              <label htmlFor={`${uid}-email`}>{tr('公开联系邮箱（可选，独立于登录邮箱）', 'Public Contact Email (optional)')}</label>
            </div>
            <input
              id={`${uid}-email`}
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder={tr('希望对外显示的联系邮箱，不填则不公开', 'Public email address (leave blank to hide)')}
            />
          </div>

          <div className="media-picker-block">
            <div className="media-picker-head">
              <div>
                <strong>{tr('更多联系方式 / 主页链接（可选）', 'Links & Socials (optional)')}</strong>
                <small>{tr('例如 GitHub、作品集或博客', 'e.g. GitHub, portfolio, or blog')}</small>
              </div>
              <button
                type="button"
                className="cms-ghost-btn"
                disabled={saving}
                onClick={() => setContactLinks((prev) => [...prev, { label: '', url: '' }])}
              >
                <Icon name="plus" size={14} />
                <span>{tr('添加链接', 'Add Link')}</span>
              </button>
            </div>
            {contactLinks.map((link, idx) => (
              <div key={idx} className="contact-link-edit-row">
                <input
                  type="text"
                  placeholder={tr('名称（如 GitHub）', 'Label (e.g. GitHub)')}
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
                  aria-label={tr('删除链接', 'Remove link')}
                  onClick={() => setContactLinks((prev) => prev.filter((_, i) => i !== idx))}
                >
                  {tr('删除', 'Remove')}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {previewOpen && (
        <section className="cloud-preview-box" aria-label={tr('草稿公开预览', 'Draft public preview')}>
          <h3>{tr('当前草稿公开效果预览（空白字段自动隐藏）', 'Public Draft Preview (empty fields hidden)')}</h3>
          {previewDraft.avatarAssetId && (
            <SignedImage
              assetId={previewDraft.avatarAssetId}
              scope="admin"
              variant="thumb"
              alt={tr('头像预览', 'Avatar preview')}
              className="profile-avatar-preview"
            />
          )}
          {previewDraft.displayName && <p><strong>{previewDraft.displayName}</strong></p>}
          {previewDraft.focusAreas && <p>{tr('关注方向：', 'Focus: ')}{previewDraft.focusAreas}</p>}
          {previewDraft.bio && <div>{renderParagraphs(previewDraft.bio)}</div>}
          {previewDraft.contactEmail && <p>{tr('联系邮箱：', 'Email: ')}{previewDraft.contactEmail}</p>}
          {previewDraft.contactLinks.length > 0 && (
            <p>
              {tr('链接：', 'Links: ')}
              {previewDraft.contactLinks.map((l) => `${l.label} (${l.url})`).join(' · ')}
            </p>
          )}
          {!previewDraft.displayName &&
            !previewDraft.bio &&
            !previewDraft.focusAreas &&
            !previewDraft.avatarAssetId &&
            !previewDraft.contactEmail &&
            previewDraft.contactLinks.length === 0 && (
              <p>
                {tr(
                  '个人介绍待完善——访客会看到简洁的待完善状态，不会展示占位经历。',
                  'Profile is empty—visitors will see a clean placeholder.',
                )}
              </p>
            )}
        </section>
      )}

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
            onClick={() => setPreviewOpen((v) => !v)}
          >
            <Icon name="eye" size={15} />
            <span>{previewOpen ? tr('收起预览', 'Hide Preview') : tr('预览', 'Preview')}</span>
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
            {saving ? tr('处理中…', 'Publishing…') : current?.isPublished ? tr('发布更新', 'Publish Update') : tr('发布介绍', 'Publish Profile')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
