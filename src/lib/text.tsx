import type { ReactNode } from 'react'

export function safeExternalUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > 500) return null
  try {
    const parsed = new URL(trimmed)
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname) {
      return parsed.toString()
    }
  } catch {
    return null
  }
  return null
}

export function isValidEmail(raw: string): boolean {
  const trimmed = raw.trim()
  return Boolean(trimmed) && trimmed.length <= 180 && /^[^\s@<>?/]+@[^\s@<>?/]+\.[^\s@<>?/]+$/.test(trimmed)
}

export function safeMailtoHref(raw: string): string | null {
  const trimmed = raw.trim()
  return isValidEmail(trimmed) ? `mailto:${trimmed}` : null
}

const INLINE_TOKEN_SOURCE =
  '`([^`\\n]+)`|\\[([^\\]\\n]+)\\]\\(((?:[^()\\s]+|\\([^()\\s]*\\))+)\\)|\\*\\*\\*(?!\\*)([^\\n]+?)\\*\\*\\*|\\*\\*(?!\\*)([^\\n]+?)\\*\\*|\\*([^\\s*](?:[^*\\n]*[^\\s*])?)\\*'

export function renderInline(text: string, depth = 0, allowLinks = true): ReactNode {
  if (!text || depth > 4) return text
  const pattern = new RegExp(INLINE_TOKEN_SOURCE, 'g')
  const parts: ReactNode[] = []
  let lastIndex = 0
  let tokenKey = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const [full, inlineCode, linkLabel, linkUrl, boldItalicText, boldText, italicText] = match

    if (inlineCode !== undefined) {
      parts.push(
        <code key={`ic-${tokenKey++}`} className="detail-inline-code">
          {inlineCode}
        </code>,
      )
    } else if (linkLabel !== undefined && linkUrl !== undefined) {
      const safe = allowLinks ? safeExternalUrl(linkUrl) : null
      if (safe !== null) {
        parts.push(
          <a
            key={`ln-${tokenKey++}`}
            href={safe}
            target="_blank"
            rel="noopener noreferrer"
            className="detail-inline-link"
          >
            {renderInline(linkLabel, depth + 1, false)}
          </a>,
        )
      } else {
        parts.push(full)
      }
    } else if (boldItalicText !== undefined) {
      parts.push(
        <strong key={`bi-${tokenKey++}`}>
          <em>{renderInline(boldItalicText, depth + 1, allowLinks)}</em>
        </strong>,
      )
    } else if (boldText !== undefined) {
      parts.push(
        <strong key={`b-${tokenKey++}`}>
          {renderInline(boldText, depth + 1, allowLinks)}
        </strong>,
      )
    } else if (italicText !== undefined) {
      parts.push(
        <em key={`i-${tokenKey++}`}>
          {renderInline(italicText, depth + 1, allowLinks)}
        </em>,
      )
    } else {
      parts.push(full)
    }

    lastIndex = pattern.lastIndex
  }

  if (parts.length === 0) return text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts.length === 1 ? parts[0] : parts
}

function isFenceStart(line: string): boolean {
  return /^\s*```/.test(line)
}

function isFenceEnd(line: string): boolean {
  return /^\s*```\s*$/.test(line)
}

function isHorizontalRule(line: string): boolean {
  return /^\s*(?:-{3,}|\*{3,})\s*$/.test(line)
}

function matchHeading(line: string): { level: 3 | 4; content: string } | null {
  const h4 = line.match(/^\s*###\s+(.+)$/)
  if (h4) return { level: 4, content: h4[1].trim() }
  const h3 = line.match(/^\s*#{1,2}\s+(.+)$/)
  if (h3) return { level: 3, content: h3[1].trim() }
  return null
}

function matchBlockquote(line: string): string | null {
  const m = line.match(/^\s*>\s?(.*)$/)
  return m ? m[1] : null
}

function matchUnorderedItem(line: string): string | null {
  if (isHorizontalRule(line)) return null
  const m = line.match(/^\s*[-*]\s+(.+)$/)
  return m ? m[1].trim() : null
}

function matchOrderedItem(line: string): string | null {
  const m = line.match(/^\s*\d+\.\s+(.+)$/)
  return m ? m[1].trim() : null
}

function isBlockStarter(line: string): boolean {
  return (
    isFenceStart(line) ||
    isHorizontalRule(line) ||
    matchHeading(line) !== null ||
    matchBlockquote(line) !== null ||
    matchUnorderedItem(line) !== null ||
    matchOrderedItem(line) !== null
  )
}

export function renderParagraphs(text: string): ReactNode[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (!normalized.trim()) return []

  const lines = normalized.split('\n')
  const nodes: ReactNode[] = []
  let i = 0
  let blockKey = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i += 1
      continue
    }

    if (isFenceStart(line)) {
      i += 1
      const codeLines: string[] = []
      while (i < lines.length && !isFenceEnd(lines[i])) {
        codeLines.push(lines[i])
        i += 1
      }
      if (i < lines.length && isFenceEnd(lines[i])) {
        i += 1
      }
      nodes.push(
        <pre key={blockKey++} className="detail-code-block">
          <code>{codeLines.join('\n')}</code>
        </pre>,
      )
      continue
    }

    if (isHorizontalRule(line)) {
      nodes.push(<hr key={blockKey++} className="detail-divider" />)
      i += 1
      continue
    }

    const heading = matchHeading(line)
    if (heading) {
      if (heading.level === 4) {
        nodes.push(
          <h4 key={blockKey++} className="detail-subheading">
            {renderInline(heading.content)}
          </h4>,
        )
      } else {
        nodes.push(
          <h3 key={blockKey++} className="detail-heading">
            {renderInline(heading.content)}
          </h3>,
        )
      }
      i += 1
      continue
    }

    if (matchBlockquote(line) !== null) {
      const quoteLines: string[] = []
      while (i < lines.length) {
        const q = matchBlockquote(lines[i])
        if (q === null) break
        quoteLines.push(q)
        i += 1
      }
      nodes.push(
        <blockquote key={blockKey++} className="detail-quote">
          {quoteLines.map((qLine, idx) => (
            <span key={idx}>
              {idx > 0 && <br />}
              {renderInline(qLine)}
            </span>
          ))}
        </blockquote>,
      )
      continue
    }

    if (matchUnorderedItem(line) !== null) {
      const items: string[] = []
      while (i < lines.length) {
        const item = matchUnorderedItem(lines[i])
        if (item === null) break
        items.push(item)
        i += 1
      }
      nodes.push(
        <ul key={blockKey++} className="detail-list">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>,
      )
      continue
    }

    if (matchOrderedItem(line) !== null) {
      const items: string[] = []
      while (i < lines.length) {
        const item = matchOrderedItem(lines[i])
        if (item === null) break
        items.push(item)
        i += 1
      }
      nodes.push(
        <ol key={blockKey++} className="detail-list">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>,
      )
      continue
    }

    const paraLines: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStarter(lines[i])) {
      paraLines.push(lines[i])
      i += 1
    }
    const trimmedBlock = paraLines.join('\n').trim()
    if (trimmedBlock) {
      const splitLines = trimmedBlock.split('\n')
      nodes.push(
        <p key={blockKey++} className="detail-paragraph">
          {splitLines.map((pLine, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {renderInline(pLine)}
            </span>
          ))}
        </p>,
      )
    }
  }

  return nodes
}

export function buildStatusLabel(item: {
  isPublished: boolean
  hasUnpublishedChanges: boolean
}): string {
  if (!item.isPublished) return '草稿'
  if (item.hasUnpublishedChanges) return '已发布（有未发布改动）'
  return '已发布'
}
