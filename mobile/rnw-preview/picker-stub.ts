// Stands in for the OS photo picker so the REAL attach flow runs without a
// native modal. Returns a tiny valid base64 (for the upload pipeline) and a
// data-URI preview (a recognizable landscape) for the composer/echo thumbnail.
export type MobileImageSource = 'library' | 'files'
export type PickedMobileImage = { readonly base64: string; readonly uri?: string }

export class ImageLibraryPermissionError extends Error {
  constructor() {
    super('Photo library permission denied')
    this.name = 'ImageLibraryPermissionError'
  }
}

const PHOTO_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='180'>
  <defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'>
  <stop offset='0' stop-color='#6cb6ff'/><stop offset='1' stop-color='#cfeaff'/></linearGradient></defs>
  <rect width='240' height='180' fill='url(#s)'/>
  <circle cx='188' cy='42' r='24' fill='#ffe08a'/>
  <path d='M0 135 L70 80 L120 120 L170 72 L240 135 Z' fill='#3f7d4f'/>
  <path d='M0 152 L240 152 L240 180 L0 180 Z' fill='#2f6140'/>
  <text x='120' y='172' font-family='sans-serif' font-size='14' fill='#fff' text-anchor='middle'>PHOTO.PNG</text></svg>`

export async function pickMobileImage(_source: MobileImageSource): Promise<PickedMobileImage> {
  return { base64: 'iVBORw0KGgoAAAANSUhEUg==', uri: `data:image/svg+xml;base64,${btoa(PHOTO_SVG)}` }
}
