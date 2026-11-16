import { Component, type ReactNode } from 'react'
import { Modal } from './Modal'

/** A rejected React.lazy import must never remove the application root. */
export class LazyModalBoundary extends Component<{
  active: boolean
  onClose: () => void
  children: ReactNode
}, { failed: boolean }> {
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
    return <Modal open close={this.close} label="弹窗加载失败" className="lazy-error-dialog">
      <h2>这个窗口暂时没有打开</h2>
      <p>可以关闭后继续浏览小屋。网络恢复后，重新加载页面可再次打开窗口。</p>
      <button type="button" className="cms-primary-btn" onClick={() => window.location.reload()}>重新加载页面</button>
    </Modal>
  }
}
