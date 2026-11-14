import { useState } from 'react'
import { isCloudConfigured } from '../lib/supabase'
import { enterLocalOwnerMode, signInAdmin, signOutAdmin } from '../lib/api'
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
}: {
  adminEmail: string | null
  pendingCleanupCount: number
  backendHealth: LocalStudioHealth
  hasContent: boolean
  onSignedIn: () => Promise<void>
  onSignedOut: () => Promise<void>
  onRetryCleanup: () => Promise<void>
  onImportSample?: () => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const isLocalStudio = backendHealth.mode === 'local-studio'

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('请输入管理员邮箱和密码。')
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
      setMessage('已进入主人管理模式。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请检查账号或网络。')
    } finally {
      setBusy(false)
    }
  }

  async function handleEnterLocalOwner() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await enterLocalOwnerMode()
      await onSignedIn()
      setMessage('已进入本地编辑模式，修改会保存在本机 local-data/。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法进入本地编辑模式。')
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
      setMessage(isLocalStudio ? '已退出编辑模式，恢复访客浏览视图。' : '已退出管理模式，恢复访客浏览视图。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '退出失败，请重试。')
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
      setMessage('待清理旧素材已检查完毕。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '素材清理重试失败，请稍后再试。')
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
      setMessage('已生成中性示例作品与手记（含本地封面图），可在各房间修改或删除。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '示例数据导入失败。')
    } finally {
      setImporting(false)
    }
  }

  if (backendHealth.mode === 'static-snapshot') {
    return (
      <section className="admin-auth-section" aria-label="纯静态展馆模式">
        <div className="admin-auth-header">
          <span className="admin-auth-title">
            <Icon name="home" size={16} />
            <strong>纯静态展馆模式</strong>
          </span>
        </div>
        <p className="admin-auth-hint">
          当前站点仅展示已导出的公开内容（只读）。如需修改自己的小屋内容，请在电脑本地运行 <code>npm run dev</code> 进入编辑。
        </p>
      </section>
    )
  }

  if (backendHealth.mode === 'unconfigured-readonly' && !isCloudConfigured) {
    return (
      <section className="admin-auth-section" aria-label="只读展示状态">
        <div className="admin-auth-header">
          <span className="admin-auth-title">
            <Icon name="lock" size={16} />
            <strong>只读展示状态</strong>
          </span>
        </div>
        <p className="admin-auth-hint">
          当前未配置云端环境，也未连接到本地工作室服务。若你在自己的电脑使用，请通过 <code>npm run dev</code> 打开即可本地编辑与保存。
        </p>
      </section>
    )
  }

  return (
    <section className="admin-auth-section" aria-label="主人登录与管理">
      <div className="admin-auth-header">
        <span className="admin-auth-title">
          <Icon name={isLocalStudio ? 'pencil' : 'lock'} size={16} />
          <strong>
            {adminEmail
              ? isLocalStudio
                ? '本地编辑模式'
                : '主人已登录'
              : isLocalStudio
                ? '本地工作室（本机自用）'
                : '主人登录'}
          </strong>
        </span>
        {adminEmail ? (
          <button
            type="button"
            className="cms-ghost-btn"
            disabled={busy}
            onClick={() => void handleLogout()}
          >
            {busy ? '正在退出…' : isLocalStudio ? '退出编辑（访客预览）' : '退出登录'}
          </button>
        ) : isLocalStudio ? (
          <button
            type="button"
            className="cms-primary-btn"
            disabled={busy || !backendHealth.writable}
            onClick={() => void handleEnterLocalOwner()}
          >
            {busy ? '正在进入…' : backendHealth.writable ? '进入编辑模式' : '仅本机可编辑'}
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
            {expanded ? '收起' : '登录管理'}
          </button>
        )}
      </div>

      {isLocalStudio && !adminEmail && (
        <p className="admin-auth-hint">
          {backendHealth.writable
            ? '无需云端账号：作品、手记、图片与演示视频会直接保存在本机 local-data/ 目录；未点击发布的草稿不会在访客模式出现。'
            : '当前通过非本机地址访问，仅允许访客只读浏览；请在电脑本机（127.0.0.1 / localhost）开启编辑。'}
        </p>
      )}

      {adminEmail && (
        <div className="admin-logged-meta">
          <p className="admin-auth-hint">
            {isLocalStudio
              ? '当前身份：本地主人 · 内容与素材保存在本机 local-data/（各房间已显示添加与编辑入口）'
              : `当前账号：${adminEmail}（各房间已显示添加与编辑入口）`}
          </p>
          {isLocalStudio && !hasContent && onImportSample && (
            <div className="cleanup-banner" role="region" aria-label="导入初始示例">
              <span>当前小屋还没有内容，可先导入 1 组中性示例体验效果</span>
              <button
                type="button"
                className="cms-ghost-btn"
                disabled={importing}
                onClick={() => void handleSampleImport()}
              >
                <Icon name="plus" size={14} />
                <span>{importing ? '生成中…' : '导入示例内容'}</span>
              </button>
            </div>
          )}
          {pendingCleanupCount > 0 && (
            <div className="cleanup-banner" role="status">
              <span>有 {pendingCleanupCount} 个旧素材待从存储清理</span>
              <button
                type="button"
                className="cms-ghost-btn"
                disabled={cleaning}
                onClick={() => void handleCleanup()}
              >
                <Icon name="refresh" size={14} />
                <span>{cleaning ? '清理中…' : '重试清理'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {!adminEmail && !isLocalStudio && expanded && (
        <form className="admin-login-form" onSubmit={(e) => void handleLogin(e)}>
          {!isCloudConfigured && (
            <p className="cms-error-inline" role="alert">
              尚未配置云端环境（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY），当前仅本地展示。
            </p>
          )}
          <label className="cms-field">
            <span>管理员邮箱</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="输入你的管理员邮箱"
              disabled={busy || !isCloudConfigured}
            />
          </label>
          <label className="cms-field">
            <span>登录密码</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入登录密码"
              disabled={busy || !isCloudConfigured}
            />
          </label>
          <p className="admin-auth-hint">仅开放单一主人账号登录，不提供访客注册；登录邮箱不会公开展示。</p>
          {error && <p className="cms-error-inline" role="alert">{error}</p>}
          <button type="submit" className="cms-primary-btn" disabled={busy || !isCloudConfigured}>
            {busy ? '正在验证身份…' : '登录小屋'}
          </button>
        </form>
      )}

      {error && (isLocalStudio || !expanded) && <p className="cms-error-inline" role="alert">{error}</p>}
      {message && !error && <p className="name-message" role="status">{message}</p>}
    </section>
  )
}
