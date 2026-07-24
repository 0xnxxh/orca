/**
 * Demo animations live as GIF + smaller MP4 + JPG poster.
 * Posters/videos share basename under /docs/posters|videos or /whats-new/posters|videos.
 */
export function posterFor(src: string) {
  const name = src
    .split('/')
    .pop()!
    .replace(/\.gif$/, '.jpg')
  if (src.startsWith('/docs/')) {
    return `/docs/posters/${name}`
  }
  return `/whats-new/posters/${name}`
}

export function videoFor(src: string) {
  const name = src
    .split('/')
    .pop()!
    .replace(/\.gif$/, '.mp4')
  if (src.startsWith('/docs/')) {
    return `/docs/videos/${name}`
  }
  return `/whats-new/videos/${name}`
}
