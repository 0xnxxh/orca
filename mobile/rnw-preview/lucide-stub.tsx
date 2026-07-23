import { createElement } from 'react'

type IconProps = { size?: number; color?: string; strokeWidth?: number; fill?: string }
function glyph(char: string) {
  return function Icon({ size = 20, color = '#888' }: IconProps) {
    return createElement(
      'span',
      { style: { fontSize: size, lineHeight: `${size}px`, color, display: 'inline-flex' } },
      char
    )
  }
}
export const ArrowUp = glyph('↑')
export const ImagePlus = glyph('🖼')
export const Mic = glyph('🎙')
export const Square = glyph('■')
export const X = glyph('✕')
export const ChevronDown = glyph('▾')
export const Copy = glyph('⧉')
export const SquareChevronRight = glyph('▸')
