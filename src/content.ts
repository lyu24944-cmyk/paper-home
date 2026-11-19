import type { Locale } from './lib/i18n'
import type { Place, RoomMeta } from './types/content'

export type { Place }

// Keep Place IDs stable so corridor stops and camera paths never break.
export const rooms: RoomMeta[] = [
  { id: 'yard', name: '小院', note: '故事开始的地方', icon: 'sun' },
  { id: 'hall', name: '走廊', note: '推开一扇喜欢的门', icon: 'door' },
  { id: 'study', name: '创作手记', note: '过程、尝试与判断', icon: 'book' },
  { id: 'gallery', name: '作品室', note: '完成效果与实际成果', icon: 'frame' },
  { id: 'blank', name: '关于我', note: '认识小屋的主人', icon: 'spark' },
]

const roomsEn: Record<Place, { name: string; note: string }> = {
  yard: { name: 'Courtyard', note: 'Where the story begins' },
  hall: { name: 'Corridor', note: 'Push open a door you like' },
  study: { name: 'Study Notes', note: 'Process, trials & decisions' },
  gallery: { name: 'Gallery', note: 'Finished works & outcomes' },
  blank: { name: 'About Me', note: 'Meet the cottage keeper' },
}

export function getLocalizedRoom(place: Place, locale: Locale = 'zh'): RoomMeta {
  const base = rooms.find((r) => r.id === place) ?? rooms[0]
  if (locale !== 'en') return base
  const en = roomsEn[base.id]
  return { ...base, name: en.name, note: en.note }
}

export function getLocalizedRooms(locale: Locale = 'zh'): RoomMeta[] {
  return locale === 'en' ? rooms.map((r) => ({ ...r, ...roomsEn[r.id] })) : rooms
}

export function roomName(place: Place, locale: Locale = 'zh'): string {
  if (locale === 'en') return roomsEn[place]?.name ?? 'My Cottage'
  return rooms.find((r) => r.id === place)?.name ?? '我的小屋'
}
