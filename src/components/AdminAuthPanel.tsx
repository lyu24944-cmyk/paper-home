import { useState } from 'react'
import { isCloudConfigured } from '../lib/supabase'
import { signInAdmin, signOutAdmin } from '../lib/api'
import { Icon } from './Icon'

export function AdminAuthPanel({
  adminEmail,
  pendingCleanupCount,
  onSignedIn,
  onSignedOut,
  onRetryCleanup,
}: {
  adminEmail: string | null
  pendingCleanupCount: number
  onSignedIn: () => Promise<void>
  onSignedOut: () => Promise<void>
  onRetryCleanup: () => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

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

  async function handleLogout() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await signOutAdmin()
      await onSignedOut()
      setMessage('已退出管理模式，恢复访客浏览视图。')
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

  return (
    <section className="admin-auth-section" aria-label="主人登录与管理">
      <div className="admin-auth-header">
        <span className="admin-auth-title">
          <Icon name="lock" size={16} />
          <strong>{adminEmail ? '主人已登录' : '主人登录'}</strong>
        </span>
        {adminEmail ? (
          <button
            type="button"
            className="cms-ghost-btn"
            disabled={busy}
            onClick={() => void handleLogout()}
          >
            {busy ? '正在退出…' : '退出登录'}
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

      {adminEmail && (
        <div className="admin-logged-meta">
          <p className="admin-auth-hint">当前账号：{adminEmail}（各房间已显示添加与编辑入口）</p>
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

      {!adminEmail && expanded && (
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

      {message && !error && <p className="name-message" role="status">{message}</p>}
    </section>
  )
}
