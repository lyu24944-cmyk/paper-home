import { Component, type ContextType, type ReactNode } from 'react'
import { I18nContext } from '../lib/i18n'
import { Modal } from './Modal'

/** A rejected React.lazy import must never remove the application root. */
export class LazyModalBoundary extends Component<{
  active: boolean
  onClose: () => void
  children: ReactNode
}, { failed: boolean }> {
  static contextType = I18nContext
  declare context: ContextType<typeof I18nContext>
  state = { failed: false }
  private returnFocus: HTMLElement | null = null

  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  private close = () => {
    this.props.onClose()
    requestAnimationFrame(() => {
      if (this.returnFocus?.isConnected) this.returnFocus.focus()
      else document.querySelector<HTMLButtonElement>('.map-button')?.focus()
    })
  }
  render() {
    if (!this.state.failed) return this.props.children
    if (!this.props.active) return null
    const tr = this.context?.tr ?? ((zh: string) => zh)
    return <Modal open close={this.close} label={tr('弹窗加载失败', 'Dialog failed to load')} className="lazy-error-dialog">
      <h2>{tr('这个窗口暂时没有打开', 'This window could not be opened')}</h2>
      <p>{tr('可以关闭后继续浏览小屋。网络恢复后，重新加载页面可再次打开窗口。', 'You can close this and keep browsing the cottage. Reload once your connection recovers to reopen this window.')}</p>
      <button type="button" className="cms-primary-btn" onClick={() => window.location.reload()}>{tr('重新加载页面', 'Reload Page')}</button>
    </Modal>
  }
}
