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

export function roomName(place: Place): string {
  return rooms.find((r) => r.id === place)?.name ?? '我的小屋'
}
