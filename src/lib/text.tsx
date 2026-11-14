import type { ReactNode } from 'react'

export function safeExternalUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString()
    }
  } catch {
    return null
  }
  return null
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
