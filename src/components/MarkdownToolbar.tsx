import { useLayoutEffect, useRef, type RefObject } from 'react'
import { Icon } from './Icon'
import { safeExternalUrl } from '../lib/text'

interface SelectionRange {
  start: number
  end: number
}

const BLOCK_MARKER_RE = /^\s*(?:#{1,3}\s+|[-*]\s+|\d+\.\s+|>\s?|```)/

export function MarkdownToolbar({
  textareaRef,
  value,
  onChange,
  preview,
  onTogglePreview,
  disabled = false,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (next: string) => void
  preview: boolean
  onTogglePreview: () => void
  disabled?: boolean
}) {
  const pendingSelectionRef = useRef<SelectionRange | null>(null)
  const prevPreviewRef = useRef(preview)

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!preview && el) {
      if (pendingSelectionRef.current) {
        const sel = pendingSelectionRef.current
        pendingSelectionRef.current = null
        el.focus({ preventScroll: true })
        const maxLen = el.value.length
        el.setSelectionRange(
          Math.max(0, Math.min(sel.start, maxLen)),
          Math.max(0, Math.min(sel.end, maxLen)),
        )
      } else if (prevPreviewRef.current) {
        el.focus({ preventScroll: true })
      }
    }
    prevPreviewRef.current = preview
  }, [value, preview, textareaRef])

  function applyEdit(nextValue: string, start: number, end: number) {
    pendingSelectionRef.current = { start, end }
    onChange(nextValue)
  }

  function getSelection(): { start: number; end: number; selected: string } {
    const el = textareaRef.current
    if (!el) {
      return { start: value.length, end: value.length, selected: '' }
    }
    const start = Math.max(0, Math.min(el.selectionStart ?? value.length, value.length))
    const end = Math.max(start, Math.min(el.selectionEnd ?? value.length, value.length))
    return { start, end, selected: value.slice(start, end) }
  }

  function handleLinePrefix(prefix: string, placeholder: string) {
    const { start, end, selected } = getSelection()

    if (selected.includes('\n')) {
      const transformed = selected
        .split('\n')
        .map((line) => (line.trim() ? `${prefix}${line}` : line))
        .join('\n')
      const next = value.slice(0, start) + transformed + value.slice(end)
      applyEdit(next, start, start + transformed.length)
      return
    }

    const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1
    const lineEndIdx = value.indexOf('\n', start)
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx
    const currentLine = value.slice(lineStart, lineEnd)

    if (selected.length > 0) {
      if (start === lineStart && !BLOCK_MARKER_RE.test(currentLine)) {
        const next = value.slice(0, start) + prefix + selected + value.slice(end)
        applyEdit(next, start + prefix.length, start + prefix.length + selected.length)
      } else {
        const lead = start > 0 && value[start - 1] !== '\n' ? '\n' : ''
        const insert = `${lead}${prefix}${selected}`
        const next = value.slice(0, start) + insert + value.slice(end)
        const selStart = start + lead.length + prefix.length
        applyEdit(next, selStart, selStart + selected.length)
      }
      return
    }

    if (currentLine.trim() === '') {
      const insert = `${prefix}${placeholder}`
      const next = value.slice(0, lineStart) + insert + value.slice(lineEnd)
      applyEdit(next, lineStart + prefix.length, lineStart + insert.length)
      return
    }

    if (currentLine.startsWith(prefix)) {
      const next = value.slice(0, lineStart) + currentLine.slice(prefix.length) + value.slice(lineEnd)
      const nextPos = Math.max(lineStart, start - prefix.length)
      applyEdit(next, nextPos, nextPos)
      return
    }

    if (BLOCK_MARKER_RE.test(currentLine)) {
      const insert = `\n${prefix}${placeholder}`
      const next = value.slice(0, lineEnd) + insert + value.slice(lineEnd)
      const selStart = lineEnd + 1 + prefix.length
      applyEdit(next, selStart, selStart + placeholder.length)
      return
    }

    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart)
    applyEdit(next, start + prefix.length, end + prefix.length)
  }

  function handleBold() {
    const { start, end, selected } = getSelection()
    const inner = selected || '加粗文字'
    const insert = `**${inner}**`
    const next = value.slice(0, start) + insert + value.slice(end)
    applyEdit(next, start + 2, start + 2 + inner.length)
  }

  function handleCode() {
    const { start, end, selected } = getSelection()
    if (selected.includes('\n')) {
      const lead = start > 0 && value[start - 1] !== '\n' ? '\n```\n' : '```\n'
      const tail = end < value.length && value[end] !== '\n' ? '\n```\n' : '\n```'
      const insert = `${lead}${selected}${tail}`
      const next = value.slice(0, start) + insert + value.slice(end)
      applyEdit(next, start + lead.length, start + lead.length + selected.length)
      return
    }
    const inner = selected || '代码'
    const insert = `\`${inner}\``
    const next = value.slice(0, start) + insert + value.slice(end)
    applyEdit(next, start + 1, start + 1 + inner.length)
  }

  function handleLink() {
    const { start, end, selected } = getSelection()
    if (selected && safeExternalUrl(selected)) {
      const label = '链接文字'
      const url = selected.trim()
      const insert = `[${label}](${url})`
      const next = value.slice(0, start) + insert + value.slice(end)
      applyEdit(next, start + 1, start + 1 + label.length)
      return
    }
    const label = selected || '链接文字'
    const url = 'https://example.com'
    const insert = `[${label}](${url})`
    const next = value.slice(0, start) + insert + value.slice(end)
    if (selected) {
      const urlStart = start + label.length + 3
      applyEdit(next, urlStart, urlStart + url.length)
    } else {
      applyEdit(next, start + 1, start + 1 + label.length)
    }
  }

  const toolsDisabled = disabled || preview

  return (
    <div className="markdown-toolbar" role="toolbar" aria-label="正文排版工具栏">
      <div className="markdown-tool-group">
        <button
          type="button"
          className="markdown-tool-btn"
          disabled={toolsDisabled}
          title="插入二级小标题（## ）"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleLinePrefix('## ', '小标题')}
        >
          小标题
        </button>
        <button
          type="button"
          className="markdown-tool-btn"
          disabled={toolsDisabled}
          title="加粗选中文字（**文字**）"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleBold}
        >
          加粗
        </button>
        <button
          type="button"
          className="markdown-tool-btn"
          disabled={toolsDisabled}
          title="插入无序列表（- ）"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleLinePrefix('- ', '列表项')}
        >
          列表
        </button>
        <button
          type="button"
          className="markdown-tool-btn"
          disabled={toolsDisabled}
          title="插入引用段落（> ）"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleLinePrefix('> ', '引用内容')}
        >
          引用
        </button>
        <button
          type="button"
          className="markdown-tool-btn"
          disabled={toolsDisabled}
          title="插入行内代码或代码块"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleCode}
        >
          代码
        </button>
        <button
          type="button"
          className="markdown-tool-btn"
          disabled={toolsDisabled}
          title="插入外部链接（https://）"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleLink}
        >
          链接
        </button>
      </div>

      <button
        type="button"
        className={`markdown-tool-btn markdown-preview-toggle ${preview ? 'active' : ''}`}
        aria-pressed={preview}
        disabled={disabled}
        onClick={onTogglePreview}
      >
        <Icon name={preview ? 'pencil' : 'eye'} size={13} />
        <span>{preview ? '返回编辑' : '排版预览'}</span>
      </button>
    </div>
  )
}
