import { useI18n } from '../lib/i18n'
import { buildStatusLabel, renderParagraphs, safeExternalUrl, safeMailtoHref } from '../lib/text'
import type {
  AdminCottageData,
  AdminNote,
  AdminProject,
  PublicCottageData,
  PublicNote,
  PublicProject,
} from '../types/content'
import { Icon } from './Icon'
import { SignedImage } from './SignedImage'

function ReorderButtons({
  index,
  total,
  disabled,
  label,
  onMove,
}: {
  index: number
  total: number
  disabled: boolean
  label: string
  onMove: (delta: -1 | 1) => void
}) {
  const { tr } = useI18n()
  return (
    <div className="reorder-btn-group">
      <button
        type="button"
        className="cms-mini-btn"
        data-sound="step"
        aria-label={tr(`上移${label}`, `Move ${label} up`)}
        disabled={disabled || index === 0}
        onClick={() => onMove(-1)}
      >
        <Icon name="up" size={14} />
      </button>
      <button
        type="button"
        className="cms-mini-btn"
        data-sound="step"
        aria-label={tr(`下移${label}`, `Move ${label} down`)}
        disabled={disabled || index >= total - 1}
        onClick={() => onMove(1)}
      >
        <Icon name="down" size={14} />
      </button>
    </div>
  )
}

export function RoomDirectory({
  place,
  isAdmin,
  cloudLoading,
  cloudError,
  adminError,
  publicData,
  adminData,
  reorderBusy,
  onCloseDirectory,
  onRetryCloud,
  onOpenPublicProject,
  onOpenAdminProjectPreview,
  onOpenProjectEditor,
  onReorderProject,
  onOpenPublicNote,
  onOpenAdminNotePreview,
  onOpenNoteEditor,
  onReorderNote,
  onOpenProfileEditor,
  onCopyEmail,
  onNavigateHall,
}: {
  place: 'study' | 'gallery' | 'blank'
  isAdmin: boolean
  cloudLoading: boolean
  cloudError: string
  adminError: string
  publicData: PublicCottageData
  adminData: AdminCottageData | null
  reorderBusy: boolean
  onCloseDirectory: () => void
  onRetryCloud: () => void
  onOpenPublicProject: (index: number) => void
  onOpenAdminProjectPreview: (project: AdminProject) => void
  onOpenProjectEditor: (project: AdminProject | null) => void
  onReorderProject: (index: number, delta: -1 | 1) => void
  onOpenPublicNote: (index: number) => void
  onOpenAdminNotePreview: (note: AdminNote) => void
  onOpenNoteEditor: (note: AdminNote | null) => void
  onReorderNote: (index: number, delta: -1 | 1) => void
  onOpenProfileEditor: () => void
  onCopyEmail: (email: string) => void
  onNavigateHall: () => void
}) {
  const { locale, tr } = useI18n()
  const publishedProjects: PublicProject[] = publicData.projects
  const publishedNotes: PublicNote[] = publicData.notes
  const projectTitleById = new Map<string, string>(
    (adminData?.projects ?? []).map((p) => [p.id, p.draft.title || tr('未命名作品', 'Untitled Project')]),
  )
  const publicProjectTitleById = new Map<string, string>(
    publishedProjects.map((p) => [p.id, p.title]),
  )

  if (place === 'gallery') {
    if (isAdmin && adminData) {
      const wallSlotById = new Map<string, number>()
      adminData.projects
        .filter((p) => p.isPublished)
        .slice(0, 3)
        .forEach((p, idx) => wallSlotById.set(p.id, idx + 1))

      return (
        <>
          <div className="drawer-handle" aria-hidden="true" />
          <div className="directory-heading">
            <h2>{tr(`作品管理（${adminData.projects.length}）`, `Projects (${adminData.projects.length})`)}</h2>
            <div className="directory-head-actions">
              <button
                type="button"
                className="cms-primary-btn compact"
                onClick={() => onOpenProjectEditor(null)}
              >
                <Icon name="plus" size={14} />
                <span>{tr('添加作品', 'Add Project')}</span>
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={tr('收起作品目录', 'Collapse project directory')}
                onClick={onCloseDirectory}
                data-sound="drawer-slide"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
          </div>

          {adminError && <p className="cms-error-inline" role="alert">{adminError}</p>}

          {adminData.projects.length === 0 ? (
            <p className="content-note">
              {tr(
                '还没有作品。点击上方「添加作品」上传封面、截图与演示视频，先保存为草稿再发布。',
                'No projects yet. Click "Add Project" above to upload a cover, screenshots, and a demo video.',
              )}
            </p>
          ) : (
            <div className="cms-manage-list">
              {adminData.projects.map((project, i) => {
                const coverId = project.draft.coverAssetId ?? project.published?.coverAssetId
                const wallSlot = wallSlotById.get(project.id)
                const titleId = `manage-project-${project.id}`
                return (
                  <div key={project.id} className="cms-manage-card" role="group" aria-labelledby={titleId}>
                    <div className="cms-manage-main">
                      {coverId ? (
                        <SignedImage
                          assetId={coverId}
                          scope="admin"
                          variant="thumb"
                          alt={project.draft.title || tr('作品封面', 'Project cover')}
                          className="art-list-thumb"
                        />
                      ) : (
                        <div className="art-list-placeholder" aria-hidden="true">{tr('无封面', 'No Cover')}</div>
                      )}
                      <div className="cms-manage-text">
                        <strong id={titleId}>{project.draft.title || tr('未命名作品', 'Untitled Project')}</strong>
                        <div className="cms-manage-subline">
                          <span className={`status-badge ${project.isPublished ? 'live' : 'draft'}`}>
                            {buildStatusLabel(project, locale)}
                          </span>
                          {wallSlot && (
                            <span className="wall-slot-badge">{tr(`墙面展位 ${wallSlot}`, `Wall Frame ${wallSlot}`)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="cms-manage-actions">
                      <button
                        type="button"
                        className="cms-mini-btn"
                        aria-describedby={titleId}
                        onClick={() => onOpenAdminProjectPreview(project)}
                      >
                        {tr('预览', 'Preview')}
                      </button>
                      <button
                        type="button"
                        className="cms-mini-btn primary"
                        aria-describedby={titleId}
                        onClick={() => onOpenProjectEditor(project)}
                      >
                        {tr('编辑', 'Edit')}
                      </button>
                      <ReorderButtons
                        index={i}
                        total={adminData.projects.length}
                        disabled={reorderBusy}
                        label={project.draft.title || tr('作品', 'project')}
                        onMove={(d) => onReorderProject(i, d)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <p className="content-note">
            {tr(
              `前 3 件已发布作品按此顺序出现在三维画框中；当前已发布 ${publishedProjects.length} 件。`,
              `The first 3 published projects hang in the 3D wall frames (${publishedProjects.length} published).`,
            )}
          </p>
        </>
      )
    }

    return (
      <>
        <div className="drawer-handle" aria-hidden="true" />
        <div className="directory-heading">
          <h2>{tr('作品室目录', 'Gallery Directory')}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={tr('收起作品目录', 'Collapse project directory')}
            data-sound="drawer-slide"
            onClick={onCloseDirectory}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {cloudError && (
          <div className="cms-error-inline" role="alert">
            <span>{cloudError}</span>
            <button type="button" className="cms-mini-btn" onClick={onRetryCloud}>{tr('重试', 'Retry')}</button>
          </div>
        )}

        {cloudLoading && publishedProjects.length === 0 ? (
          <p className="content-note">{tr('正在读取已发布作品…', 'Loading published projects…')}</p>
        ) : publishedProjects.length === 0 ? (
          <p className="content-note">
            {tr(
              '作品正在整理中，发布后会展示在这里和墙上的画框中。',
              'Projects are being prepared and will appear here and on the gallery walls once published.',
            )}
          </p>
        ) : (
          <div className="art-list">
            {publishedProjects.map((item, i) => (
              <button key={item.id} type="button" data-sound="paper-card" onClick={() => onOpenPublicProject(i)}>
                {item.coverAssetId ? (
                  <SignedImage
                    assetId={item.coverAssetId}
                    scope="public"
                    variant="thumb"
                    alt=""
                    className="art-list-thumb"
                  />
                ) : (
                  <div className="art-list-placeholder" aria-hidden="true" />
                )}
                <span className="art-list-copy">
                  <span className="art-list-title">{item.title}</span>
                  {i < 3 && <small className="wall-slot-badge">{tr(`墙面展位 ${i + 1}`, `Wall Frame ${i + 1}`)}</small>}
                </span>
                <Icon name="arrow" size={17} />
              </button>
            ))}
          </div>
        )}

        <p className="content-note">
          {tr('墙面三维展区最多展示前 3 件已发布作品；', 'Up to 3 published projects hang on the 3D gallery walls; ')}
          {publishedProjects.length > 3
            ? tr('其余作品可在上方目录中完整查看。', 'browse the rest in the list above.')
            : tr('点开任一作品可查看详情与演示视频。', 'select any work for full details & demos.')}
        </p>
      </>
    )
  }

  if (place === 'study') {
    if (isAdmin && adminData) {
      return (
        <>
          <div className="drawer-handle" aria-hidden="true" />
          <div className="directory-heading">
            <h2>{tr(`创作手记管理（${adminData.notes.length}）`, `Study Notes (${adminData.notes.length})`)}</h2>
            <div className="directory-head-actions">
              <button
                type="button"
                className="cms-primary-btn compact"
                onClick={() => onOpenNoteEditor(null)}
              >
                <Icon name="plus" size={14} />
                <span>{tr('写手记', 'Write Note')}</span>
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={tr('收起手记目录', 'Collapse notes directory')}
                onClick={onCloseDirectory}
                data-sound="drawer-slide"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
          </div>

          {adminError && <p className="cms-error-inline" role="alert">{adminError}</p>}

          {adminData.notes.length === 0 ? (
            <p className="content-note">
              {tr('还没有手记。点击「写手记」记录创作过程与技术判断。', 'No notes yet. Click "Write Note" to document your process and decisions.')}
            </p>
          ) : (
            <div className="cms-manage-list">
              {adminData.notes.map((note, i) => {
                const linkedTitle = note.draft.projectId
                  ? projectTitleById.get(note.draft.projectId)
                  : undefined
                const titleId = `manage-note-${note.id}`
                return (
                  <div key={note.id} className="cms-manage-card" role="group" aria-labelledby={titleId}>
                    <div className="cms-manage-text">
                      <strong id={titleId}>{note.draft.title || tr('未命名手记', 'Untitled Note')}</strong>
                      <div className="cms-manage-subline">
                        <span className={`status-badge ${note.isPublished ? 'live' : 'draft'}`}>
                          {buildStatusLabel(note, locale)}
                        </span>
                        {linkedTitle && <small className="linked-hint">{tr(`关联：${linkedTitle}`, `Linked: ${linkedTitle}`)}</small>}
                      </div>
                    </div>
                    <div className="cms-manage-actions">
                      <button
                        type="button"
                        className="cms-mini-btn"
                        aria-describedby={titleId}
                        onClick={() => onOpenAdminNotePreview(note)}
                      >
                        {tr('预览', 'Preview')}
                      </button>
                      <button
                        type="button"
                        className="cms-mini-btn primary"
                        aria-describedby={titleId}
                        onClick={() => onOpenNoteEditor(note)}
                      >
                        {tr('编辑', 'Edit')}
                      </button>
                      <ReorderButtons
                        index={i}
                        total={adminData.notes.length}
                        disabled={reorderBusy}
                        label={note.draft.title || tr('手记', 'note')}
                        onMove={(d) => onReorderNote(i, d)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <p className="content-note">
            {tr('手记可关联一件作品；访客仅能读取已发布手记。', 'Notes can link to a project; visitors only see published notes.')}
          </p>
        </>
      )
    }

    return (
      <>
        <div className="drawer-handle" aria-hidden="true" />
        <div className="directory-heading">
          <h2>{tr('创作手记', 'Study Notes')}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={tr('收起手记目录', 'Collapse notes directory')}
            data-sound="drawer-slide"
            onClick={onCloseDirectory}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {cloudError && (
          <div className="cms-error-inline" role="alert">
            <span>{cloudError}</span>
            <button type="button" className="cms-mini-btn" onClick={onRetryCloud}>{tr('重试', 'Retry')}</button>
          </div>
        )}
        {cloudLoading && publishedNotes.length === 0 ? (
          <p className="content-note">{tr('正在读取创作手记…', 'Loading study notes…')}</p>
        ) : publishedNotes.length === 0 ? (
          <p className="content-note">{tr('主人还没有公开发布手记，稍后再来翻看。', 'No published notes yet—check back soon.')}</p>
        ) : (
          <div className="article-list">
            {publishedNotes.map((item, i) => {
              const linkedTitle = item.projectId ? publicProjectTitleById.get(item.projectId) : undefined
              return (
                <button key={item.id} type="button" data-sound="paper-card" onClick={() => onOpenPublicNote(i)}>
                  <span className="article-item-copy">
                    <strong>{item.title}</strong>
                    {linkedTitle && <small>{tr(`关联作品：${linkedTitle}`, `Project: ${linkedTitle}`)}</small>}
                  </span>
                  <Icon name="arrow" size={19} />
                </button>
              )
            })}
          </div>
        )}
        <p className="content-note">
          {tr('记录构建这座交互式小屋时的设计与调试思考。', 'Design thoughts and build logs recorded along the way.')}
        </p>
      </>
    )
  }

  // place === 'blank' (关于我)
  if (isAdmin && adminData) {
    const profile = adminData.profile
    const draft = profile?.draft
    const validDraftLinks = (draft?.contactLinks ?? []).filter((l) => safeExternalUrl(l.url))
    const draftNowNotes = (draft?.nowNotes ?? []).filter(Boolean)
    const draftQuotes = (draft?.quotes ?? []).filter(Boolean)
    const draftEmailHref = draft?.contactEmail ? safeMailtoHref(draft.contactEmail) : null
    const hasDraft = Boolean(
      draft &&
        (draft.displayName ||
          draft.bio ||
          draft.focusAreas ||
          draft.avatarAssetId ||
          draft.contactEmail ||
          draft.contactLinks.length > 0 ||
          draftNowNotes.length > 0 ||
          draftQuotes.length > 0),
    )

    return (
      <>
        <div className="drawer-handle" aria-hidden="true" />
        <div className="directory-heading">
          <h2>{tr('关于我', 'About Me')}</h2>
          <div className="directory-head-actions">
            <button
              type="button"
              className="cms-primary-btn compact"
              onClick={onOpenProfileEditor}
            >
              <Icon name="pencil" size={14} />
              <span>{tr('编辑介绍', 'Edit Bio')}</span>
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={tr('收起关于我', 'Collapse About Me')}
              data-sound="drawer-slide"
              onClick={onCloseDirectory}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        </div>

        <span className={`status-badge ${profile?.isPublished ? 'live' : 'draft'}`}>
          {profile ? buildStatusLabel(profile, locale) : tr('待完善', 'Not set')}
        </span>

        {hasDraft && draft ? (
          <div className="profile-room-body">
            {(draft.avatarAssetId || draft.displayName || draft.focusAreas) && (
              <div className="profile-header-card">
                {draft.avatarAssetId && (
                  <SignedImage
                    assetId={draft.avatarAssetId}
                    scope="admin"
                    variant="thumb"
                    alt={tr('个人头像', 'Profile avatar')}
                    className="profile-avatar-card"
                  />
                )}
                <div className="profile-identity">
                  {draft.displayName && <p className="profile-display-name">{draft.displayName}</p>}
                  {draft.focusAreas && <p className="profile-focus-text">{tr(`关注方向：${draft.focusAreas}`, `Focus: ${draft.focusAreas}`)}</p>}
                </div>
              </div>
            )}
            {draft.bio && <div className="profile-bio-text">{renderParagraphs(draft.bio)}</div>}
            {draftNowNotes.length > 0 && (
              <div className="profile-now-box" aria-label={tr('近期在做', 'Currently working on')}>
                <strong>{tr('近期在做 · Now', 'Now')}</strong>
                <ul className="profile-now-list">
                  {draftNowNotes.map((note, idx) => (
                    <li key={idx}>
                      <span className="now-pin-index">0{idx + 1}</span>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(draftEmailHref || draft.contactEmail || validDraftLinks.length > 0) && (
              <div className="profile-contact-box">
                <strong>{tr('联系方式', 'Contact')}</strong>
                {draft.contactEmail && (
                  <div className="profile-email-row">
                    {draftEmailHref ? (
                      <a className="profile-contact-link" href={draftEmailHref}>
                        {draft.contactEmail}
                      </a>
                    ) : (
                      <span className="profile-contact-link">{draft.contactEmail}</span>
                    )}
                    <button
                      type="button"
                      className="cms-mini-btn copy-email-btn"
                      onClick={() => onCopyEmail(draft.contactEmail)}
                      aria-label={tr('复制联系邮箱', 'Copy contact email')}
                    >
                      <Icon name="copy" size={12} />
                      <span>{tr('复制', 'Copy')}</span>
                    </button>
                  </div>
                )}
                {validDraftLinks.length > 0 && (
                  <div className="profile-links-pills">
                    {validDraftLinks.map((link, idx) => (
                      <a
                        key={idx}
                        className="profile-link-pill"
                        href={safeExternalUrl(link.url)!}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Icon name="link" size={12} />
                        <span>{link.label}</span>
                        <Icon name="arrow" size={12} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="blank-note">
            {tr(
              '真实个人介绍与联系方式尚未填写。点击上方「编辑介绍」完善后即可预览与发布。',
              'Profile bio and contact details are empty. Click "Edit Bio" above to fill them in and publish.',
            )}
          </p>
        )}
      </>
    )
  }

  const pubProfile = publicData.profile
  const validLinks = (pubProfile?.contactLinks ?? []).filter((l) => safeExternalUrl(l.url))
  const pubNowNotes = (pubProfile?.nowNotes ?? []).filter(Boolean)
  const pubQuotes = (pubProfile?.quotes ?? []).filter(Boolean)
  const pubEmailHref = pubProfile?.contactEmail ? safeMailtoHref(pubProfile.contactEmail) : null
  const hasPublicProfile = Boolean(
    pubProfile &&
      (pubProfile.displayName ||
        pubProfile.bio ||
        pubProfile.focusAreas ||
        pubProfile.avatarAssetId ||
        pubProfile.contactEmail ||
        validLinks.length > 0 ||
        pubNowNotes.length > 0 ||
        pubQuotes.length > 0),
  )

  if (!hasPublicProfile || !pubProfile) {
    return (
      <>
        <div className="drawer-handle" aria-hidden="true" />
        <div className="directory-heading">
          <span className="directory-title-with-icon">
            <Icon name="user" size={22} />
            <h2>{tr('关于我', 'About Me')}</h2>
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={tr('收起关于我', 'Collapse About Me')}
            data-sound="drawer-slide"
            onClick={onCloseDirectory}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="blank-note">
          {tr(
            '个人介绍与联系方式仍在完善中，尚未填写的资料暂不公开展示。',
            'Profile and contact details are still being written.',
          )}
        </p>
        <button type="button" className="text-link" onClick={onNavigateHall}>
          {tr('再去别处逛逛', 'Keep Exploring')}
          <Icon name="arrow" size={18} />
        </button>
      </>
    )
  }

  return (
    <>
      <div className="drawer-handle" aria-hidden="true" />
      <div className="directory-heading">
        <h2>{tr('关于我', 'About Me')}</h2>
        <button
          type="button"
          className="icon-button"
          data-sound="drawer-slide"
          aria-label={tr('收起关于我', 'Collapse About Me')}
          onClick={onCloseDirectory}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="profile-room-body">
        <div className="profile-header-card">
          {pubProfile.avatarAssetId && (
            <SignedImage
              assetId={pubProfile.avatarAssetId}
              scope="public"
              variant="thumb"
              alt={pubProfile.displayName || tr('小屋主人头像', 'Cottage keeper avatar')}
              className="profile-avatar-card"
            />
          )}
          <div className="profile-identity">
            <p className="profile-display-name">{pubProfile.displayName || tr('小屋主人', 'Cottage Keeper')}</p>
            {pubProfile.focusAreas && (
              <p className="profile-focus-text">{tr(`关注方向：${pubProfile.focusAreas}`, `Focus: ${pubProfile.focusAreas}`)}</p>
            )}
          </div>
        </div>
        {pubProfile.bio && <div className="profile-bio-text">{renderParagraphs(pubProfile.bio)}</div>}
        {pubNowNotes.length > 0 && (
          <div className="profile-now-box" aria-label={tr('近期在做', 'Currently working on')}>
            <strong>{tr('近期在做 · Now', 'Now')}</strong>
            <ul className="profile-now-list">
              {pubNowNotes.map((note, idx) => (
                <li key={idx}>
                  <span className="now-pin-index">0{idx + 1}</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(pubProfile.contactEmail || validLinks.length > 0) && (
          <div className="profile-contact-box">
            <strong>{tr('联系方式', 'Contact')}</strong>
            {pubProfile.contactEmail && (
              <div className="profile-email-row">
                {pubEmailHref ? (
                  <a className="profile-contact-link" href={pubEmailHref}>
                    {pubProfile.contactEmail}
                  </a>
                ) : (
                  <span className="profile-contact-link">{pubProfile.contactEmail}</span>
                )}
                <button
                  type="button"
                  className="cms-mini-btn copy-email-btn"
                  onClick={() => onCopyEmail(pubProfile.contactEmail)}
                  aria-label={tr('复制联系邮箱', 'Copy contact email')}
                >
                  <Icon name="copy" size={12} />
                  <span>{tr('复制', 'Copy')}</span>
                </button>
              </div>
            )}
            {validLinks.length > 0 && (
              <div className="profile-links-pills">
                {validLinks.map((link, idx) => (
                  <a
                    key={idx}
                    className="profile-link-pill"
                    href={safeExternalUrl(link.url)!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon name="link" size={12} />
                    <span>{link.label}</span>
                    <Icon name="arrow" size={12} />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
