import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import { isCloudConfigured } from '../lib/supabase'
import {
  enterLocalOwnerMode,
  signInAdmin,
  signOutAdmin,
  type ExportLocalSnapshotResult,
} from '../lib/api'
import type { LocalStudioHealth } from '../types/content'
import { Icon } from './Icon'

export function AdminAuthPanel({
  adminEmail,
  pendingCleanupCount,
  backendHealth,
  hasContent,
  onSignedIn,
  onSignedOut,
  onRetryCleanup,
  onImportSample,
  onExportSnapshot,
}: {
  adminEmail: string | null
  pendingCleanupCount: number
  backendHealth: LocalStudioHealth
  hasContent: boolean
  onSignedIn: () => Promise<void>
  onSignedOut: () => Promise<void>
  onRetryCleanup: () => Promise<void>
  onImportSample?: () => Promise<void>
  onExportSnapshot?: () => Promise<ExportLocalSnapshotResult>
}) {
  const { tr } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pin,setPin]=useState('')
  const [busy, setBusy] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const isLocalStudio = backendHealth.mode === 'local-studio'

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError(tr('请输入管理员邮箱和密码。', 'Please enter your owner email and password.'))
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await signInAdmin(email, password)
      setPassword('')
      await onSignedIn()
      setExpanded(false)
      setMessage(tr('已进入主人管理模式。', 'Entered Owner editing mode.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('登录失败，请检查账号或网络。', 'Sign-in failed—check credentials or connection.'))
    } finally {
      setBusy(false)
    }
  }

  async function handleEnterLocalOwner() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await enterLocalOwnerMode(pin)
      setPin('')
      await onSignedIn()
      setMessage(tr('已进入本地编辑模式，修改会保存在本机 local-data/。', 'Local Studio active—changes save to local-data/.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('无法进入本地编辑模式。', 'Unable to enter Local Studio mode.'))
    } finally {
      setBusy(false)
    }
  }

  async function handleLogout() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await signOutAdmin()
      await onSignedOut()
      setMessage(
        isLocalStudio
          ? tr('已退出编辑模式，恢复访客浏览视图。', 'Exited editing mode—returned to visitor view.')
          : tr('已退出管理模式，恢复访客浏览视图。', 'Signed out—returned to visitor view.'),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('退出失败，请重试。', 'Sign-out failed, please retry.'))
    } finally {
      setBusy(false)
    }
  }

  async function handleCleanup() {
    setCleaning(true)
    setError('')
    setMessage('')
    try {
      await onRetryCleanup()
      setMessage(tr('待清理旧素材已检查完毕。', 'Pending unused media check completed.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('素材清理重试失败，请稍后再试。', 'Media cleanup retry failed.'))
    } finally {
      setCleaning(false)
    }
  }

  async function handleSampleImport() {
    if (!onImportSample) return
    setImporting(true)
    setError('')
    setMessage('')
    try {
      await onImportSample()
      setMessage(
        tr(
          '已生成中性示例作品与手记（含本地封面图），可在各房间修改或删除。',
          'Starter sample projects & notes generated—edit or delete them inside any room.',
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('示例数据导入失败。', 'Sample import failed.'))
    } finally {
      setImporting(false)
    }
  }

  async function handleExportSnapshot() {
    if (!onExportSnapshot) return
    setExporting(true)
    setError('')
    setMessage('')
    try {
      const res = await onExportSnapshot()
      const emptyHint =
        res.projects === 0 && res.notes === 0
          ? tr('——当前尚无已发布的作品或手记，发布后再导出即可上线展示。', ' — No published works yet; publish items before exporting for production.')
          : tr('，可直接用于静态构建或公开部署。', ', ready for static build or public deployment.')
      setMessage(
        tr(
          `已导出公开快照至 ${res.outDir}（作品 ${res.projects} 件、手记 ${res.notes} 篇、素材 ${res.assets} 个）${emptyHint}`,
          `Exported public snapshot to ${res.outDir} (${res.projects} projects, ${res.notes} notes, ${res.assets} assets)${emptyHint}`,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('公开快照导出失败，请重试。', 'Snapshot export failed, please retry.'))
    } finally {
      setExporting(false)
    }
  }

  if (backendHealth.mode === 'static-snapshot') {
    return (
      <section className="admin-auth-section" aria-label={tr('纯静态展馆模式', 'Static Exhibition Mode')}>
        <div className="admin-auth-header">
          <span className="admin-auth-title">
            <Icon name="home" size={16} />
            <strong>{tr('纯静态展馆模式', 'Static Exhibition Mode')}</strong>
          </span>
        </div>
        <p className="admin-auth-hint">
          {tr(
            '当前站点仅展示已导出的公开内容（只读）。如需修改自己的小屋内容，请在电脑本地运行 ',
            'This site serves an exported read-only snapshot. To edit content locally, run ',
          )}
          <code>npm run dev</code>
          {tr(' 进入编辑。', ' on your computer.')}
        </p>
      </section>
    )
  }

  if (backendHealth.mode === 'unconfigured-readonly' && !isCloudConfigured) {
    return (
      <section className="admin-auth-section" aria-label={tr('只读展示状态', 'Read-only Mode')}>
        <div className="admin-auth-header">
          <span className="admin-auth-title">
            <Icon name="lock" size={16} />
            <strong>{tr('只读展示状态', 'Read-only Mode')}</strong>
          </span>
        </div>
        <p className="admin-auth-hint">
          {tr(
            '当前未配置云端环境，也未连接到本地工作室服务。若你在自己的电脑使用，请通过 ',
            'No cloud backend or Local Studio server is connected. Run ',
          )}
          <code>npm run dev</code>
          {tr(' 打开即可本地编辑与保存。', ' locally to edit and save content.')}
        </p>
      </section>
    )
  }

  return (
    <section className="admin-auth-section" aria-label={tr('主人登录与管理', 'Owner Sign-in & Studio')}>
      <div className="admin-auth-header">
        <span className="admin-auth-title">
          <Icon name={isLocalStudio ? 'pencil' : 'lock'} size={16} />
          <strong>
            {adminEmail
              ? isLocalStudio
                ? tr('本地编辑模式', 'Local Editing Mode')
                : tr('主人已登录', 'Owner Signed In')
              : isLocalStudio
                ? tr('本地工作室（本机自用）', 'Local Studio (On This Device)')
                : tr('主人登录', 'Owner Sign-in')}
          </strong>
        </span>
        {adminEmail ? (
          <button
            type="button"
            className="cms-ghost-btn"
            disabled={busy}
            onClick={() => void handleLogout()}
          >
            {busy
              ? tr('正在退出…', 'Signing out…')
              : isLocalStudio
                ? tr('退出编辑（访客预览）', 'Exit Editing (Visitor View)')
                : tr('退出登录', 'Sign Out')}
          </button>
        ) : isLocalStudio ? (
          <button
            type="button"
            className="cms-primary-btn"
            disabled={busy || (!backendHealth.writable && !backendHealth.pinRequired)}
            onClick={() => void handleEnterLocalOwner()}
          >
            {busy
              ? tr('正在进入…', 'Entering…')
              : backendHealth.pinRequired && !backendHealth.writable
                ? tr('使用 PIN 进入编辑', 'Unlock with PIN')
                : backendHealth.writable
                  ? tr('进入编辑模式', 'Enter Studio')
                  : tr('仅本机可编辑', 'Localhost Only')}
          </button>
        ) : (
          <button
            type="button"
            className="cms-ghost-btn"
            onClick={() => {
              setExpanded((v) => !v)
              setError('')
            }}
          >
            {expanded ? tr('收起', 'Collapse') : tr('登录管理', 'Sign In')}
          </button>
        )}
      </div>

      {isLocalStudio && !adminEmail && backendHealth.pinRequired && !backendHealth.writable && (
        <label className="cms-field">{tr('局域网编辑 PIN', 'LAN Studio PIN')}
          <input type="password" value={pin} autoComplete="off" onChange={e=>setPin(e.target.value)} />
        </label>
      )}
      {isLocalStudio && !adminEmail && (
        <p className="admin-auth-hint">
          {backendHealth.pinRequired
            ? tr('输入本地服务的 PIN 后，可在此设备编辑；会话一小时后到期。', 'Enter the Local Studio PIN to edit from this device; session expires in 1 hour.')
            : backendHealth.writable
              ? tr('无需云端账号：作品、手记、图片与演示视频会直接保存在本机 local-data/ 目录；未点击发布的草稿不会在访客模式出现。', 'No cloud account needed: projects, notes, images & videos save straight to local-data/. Unpublished drafts stay hidden in visitor view.')
              : tr('当前通过非本机地址访问，仅允许访客只读浏览；请在电脑本机（127.0.0.1 / localhost）开启编辑。', 'Accessed from a non-local address—read-only visitor mode. Open on 127.0.0.1 / localhost to edit.')}
        </p>
      )}

      {adminEmail && (
        <div className="admin-logged-meta">
          <p className="admin-auth-hint">
            {isLocalStudio
              ? tr('当前身份：本地主人 · 内容与素材保存在本机 local-data/（各房间已显示添加与编辑入口）', 'Signed in as Local Owner · saves to local-data/ (edit actions visible in every room)')
              : tr(`当前账号：${adminEmail}（各房间已显示添加与编辑入口）`, `Signed in as ${adminEmail} (edit actions visible in every room)`)}
          </p>
          {isLocalStudio && !hasContent && onImportSample && (
            <div className="cleanup-banner" role="region" aria-label={tr('导入初始示例', 'Import starter samples')}>
              <span>{tr('当前小屋还没有内容，可先导入 1 组中性示例体验效果', 'Your cottage is empty—import starter samples to preview the layout')}</span>
              <button
                type="button"
                className="cms-ghost-btn"
                disabled={importing}
                onClick={() => void handleSampleImport()}
              >
                <Icon name="plus" size={14} />
                <span>{importing ? tr('生成中…', 'Generating…') : tr('导入示例内容', 'Import Samples')}</span>
              </button>
            </div>
          )}
          {isLocalStudio && adminEmail && onExportSnapshot && (
            <div className="cleanup-banner" role="region" aria-label={tr('导出公开快照', 'Export public snapshot')}>
              <span>{tr('发布准备：将已发布内容与素材一键导出为公开快照（site-content/）', 'Publish prep: export published content & media to site-content/')}</span>
              <button
                type="button"
                className="cms-ghost-btn"
                disabled={exporting}
                onClick={() => void handleExportSnapshot()}
              >
                <Icon name="download" size={14} />
                <span>{exporting ? tr('导出中…', 'Exporting…') : tr('导出公开快照', 'Export Snapshot')}</span>
              </button>
            </div>
          )}
          {pendingCleanupCount > 0 && (
            <div className="cleanup-banner" role="status">
              <span>{tr(`有 ${pendingCleanupCount} 个旧素材待从存储清理`, `${pendingCleanupCount} unused media files pending cleanup`)}</span>
              <button
                type="button"
                className="cms-ghost-btn"
                disabled={cleaning}
                onClick={() => void handleCleanup()}
              >
                <Icon name="refresh" size={14} />
                <span>{cleaning ? tr('清理中…', 'Cleaning…') : tr('重试清理', 'Retry Cleanup')}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {!adminEmail && !isLocalStudio && expanded && (
        <form className="admin-login-form" onSubmit={(e) => void handleLogin(e)}>
          {!isCloudConfigured && (
            <p className="cms-error-inline" role="alert">
              {tr('尚未配置云端环境（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY），当前仅本地展示。', 'Cloud environment variables (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) are not configured.')}
            </p>
          )}
          <label className="cms-field">
            <span>{tr('管理员邮箱', 'Owner Email')}</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={tr('输入你的管理员邮箱', 'Enter owner email')}
              disabled={busy || !isCloudConfigured}
            />
          </label>
          <label className="cms-field">
            <span>{tr('登录密码', 'Password')}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={tr('输入登录密码', 'Enter password')}
              disabled={busy || !isCloudConfigured}
            />
          </label>
          <p className="admin-auth-hint">
            {tr('仅开放单一主人账号登录，不提供访客注册；登录邮箱不会公开展示。', 'Single-owner sign-in only; email is never shown publicly.')}
          </p>
          {error && <p className="cms-error-inline" role="alert">{error}</p>}
          <button type="submit" className="cms-primary-btn" disabled={busy || !isCloudConfigured}>
            {busy ? tr('正在验证身份…', 'Signing in…') : tr('登录小屋', 'Sign In')}
          </button>
        </form>
      )}

      {error && (isLocalStudio || !expanded) && <p className="cms-error-inline" role="alert">{error}</p>}
      {message && !error && <p className="name-message" role="status">{message}</p>}
    </section>
  )
}
