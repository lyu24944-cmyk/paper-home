export type Place = 'yard' | 'hall' | 'study' | 'gallery' | 'blank'
export type Article = { title: string; subtitle: string; paragraphs: string[] }

// Change the room names and contents here; the house itself does not need to change.
export const rooms: { id: Place; name: string; note: string; icon: string }[] = [
  { id: 'yard', name: '小院', note: '故事开始的地方', icon: 'sun' },
  { id: 'hall', name: '走廊', note: '推开一扇喜欢的门', icon: 'door' },
  { id: 'study', name: '书房', note: '装下文字与片刻安静', icon: 'book' },
  { id: 'gallery', name: '收藏展廊', note: '收藏看见的美好', icon: 'frame' },
  { id: 'blank', name: '空白房间', note: '留给下一次灵感', icon: 'spark' },
]

export const articles: Article[] = [
  {
    title: '给生活留一扇窗', subtitle: '小屋随笔 · 示例内容',
    paragraphs: ['窗边的位置，适合放一张桌子，也适合留一点空白。', '在这里，可以写下最近读过的书、散步时看见的树，或者一个还没有想清楚的问题。不必每一篇都有答案，记录本身就有意义。', '这是一篇用来体验阅读效果的示例。以后，你的文字会住进这里。'],
  },
  {
    title: '那些想慢慢做的事', subtitle: '一张清单 · 示例内容',
    paragraphs: ['种一盆会开花的植物。把喜欢的照片洗出来。学会做一道拿手菜。走一条以前没有走过的路。', '有些事情不需要立刻完成。把它们放在这里，等某个晴朗的下午，再捡起其中一件。', '这个房间也可以成为你的笔记库、学习记录，或一个持续更新的小项目。'],
  },
  {
    title: '关于这间小屋', subtitle: '写在门口 · 示例内容',
    paragraphs: ['想在互联网上留一处自己的地方。可以不赶时间，可以把喜欢的东西摆出来，也可以偶尔什么都不写。', '所以，有了这个院子、这条走廊，和几扇还等着被推开的门。', '你现在看到的是小屋的第一版。房间里的故事，接下来由你决定。'],
  },
]

export const artworks = [
  { title: '山间来信', caption: '把远方，挂在墙上。', kind: 'mountain' as const },
  { title: '窗边的一天', caption: '一盆植物，一点阳光。', kind: 'plant' as const },
  { title: '慢慢走', caption: '路还很长，今天先走到这里。', kind: 'house' as const },
]
