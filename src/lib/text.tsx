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

export function renderParagraphs(text: string): ReactNode[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, i) => (
      <p key={i} className="detail-paragraph">
        {block.split('\n').map((line, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {line}
          </span>
        ))}
      </p>
    ))
}

export function buildStatusLabel(item: {
  isPublished: boolean
  hasUnpublishedChanges: boolean
}): string {
  if (!item.isPublished) return '草稿'
  if (item.hasUnpublishedChanges) return '已发布（有未发布改动）'
  return '已发布'
}
