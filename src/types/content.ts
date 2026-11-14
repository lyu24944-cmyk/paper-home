export type Place = 'yard' | 'hall' | 'study' | 'gallery' | 'blank'

export interface RoomMeta {
  id: Place
  name: string
  note: string
  icon: string
}

export interface ContactLink {
  label: string
  url: string
}

export interface SignedMediaEntry {
  displayUrl: string
  thumbUrl: string | null
  expiresAt: number
}

export interface MediaAsset {
  id: string
  kind: 'image' | 'video'
  status: 'uploading' | 'ready' | 'pending_delete'
  mimeType: string
  byteSize: number
  width: number | null
  height: number | null
  durationSec: number | null
  originalFilename: string | null
  createdAt?: string
}

export interface ProjectPayload {
  title: string
  summary: string
  body: string
  demoUrl: string
  coverAssetId: string | null
  galleryAssetIds: string[]
  videoAssetId: string | null
}

export interface PublicProject extends ProjectPayload {
  id: string
  slug: string
  sortOrder: number
  publishedAt: string | null
}

export interface AdminProject {
  id: string
  slug: string
  sortOrder: number
  isPublished: boolean
  publishedAt: string | null
  hasUnpublishedChanges: boolean
  version: number
  updatedAt: string
  draft: ProjectPayload
  published: (ProjectPayload & { publishedAt: string | null }) | null
}

export interface NotePayload {
  title: string
  body: string
  projectId: string | null
  imageAssetIds: string[]
  videoAssetId: string | null
}

export interface PublicNote extends NotePayload {
  id: string
  slug: string
  sortOrder: number
  publishedAt: string | null
}

export interface AdminNote {
  id: string
  slug: string
  sortOrder: number
  isPublished: boolean
  publishedAt: string | null
  hasUnpublishedChanges: boolean
  version: number
  updatedAt: string
  draft: NotePayload
  published: (NotePayload & { publishedAt: string | null }) | null
}

export interface ProfilePayload {
  displayName: string
  bio: string
  focusAreas: string
  avatarAssetId: string | null
  contactEmail: string
  contactLinks: ContactLink[]
}

export interface PublicProfile extends ProfilePayload {
  publishedAt: string | null
}

export interface AdminProfile {
  isPublished: boolean
  publishedAt: string | null
  hasUnpublishedChanges: boolean
  version: number
  updatedAt: string
  draft: ProfilePayload
  published: (ProfilePayload & { publishedAt: string | null }) | null
}

export type BackendMode = 'cloud' | 'local-studio' | 'static-snapshot' | 'unconfigured-readonly'

export interface SiteSettingsPayload {
  homeName: string
  plaqueTitle: string
  plaqueSubtitle: string
  yardHeading: string
  yardSubtitle: string
}

export const DEFAULT_SITE_SETTINGS: SiteSettingsPayload = {
  homeName: '我的小屋',
  plaqueTitle: '欢迎回家',
  plaqueSubtitle: '留一点时间，慢慢逛',
  yardHeading: '来家里坐坐。',
  yardSubtitle: '推开门，里面是我的作品、过程记录与自我介绍。',
}

export interface LocalStudioHealth {
  mode: BackendMode
  writable: boolean
  isLoopback: boolean
  hasContent: boolean
  dataDir?: string
}

export interface PublicCottageData {
  projects: PublicProject[]
  notes: PublicNote[]
  profile: PublicProfile | null
  siteSettings?: SiteSettingsPayload
  signedUrls: Record<string, SignedMediaEntry>
}

export interface AdminCottageData {
  adminUserId: string
  projects: AdminProject[]
  notes: AdminNote[]
  profile: AdminProfile | null
  siteSettings?: SiteSettingsPayload
  siteSettingsVersion?: number
  orderVersions: {
    projects: number
    notes: number
  }
  assets: Record<string, MediaAsset>
  signedUrls: Record<string, SignedMediaEntry>
  pendingCleanupCount: number
}

export interface GalleryDisplayItem {
  id: string
  title: string
  summary: string
  coverAssetId: string | null
  coverThumbUrl: string | null
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public detail?: unknown,
  ) {
    super(message)
  }
}

export class ConflictError<T = unknown> extends ApiError {
  constructor(
    message: string,
    public latest: T | null,
    public orderVersion?: number,
    public latestOrder?: string[],
  ) {
    super(409, message, 'CONFLICT')
  }
}
