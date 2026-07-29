import { describe, expect, it } from 'vitest'
import {
  describeHostedTerminalLinkPoint,
  hostedTerminalLinkPointsFromGeometry
} from '../../scripts/hosted-terminal-link-locator.mjs'

const geometry = {
  cellHeight: 20,
  cellWidth: 10,
  cursorTop: 460,
  innerHeight: 740,
  screenRect: {
    height: 600,
    width: 400
  },
  terminalRect: {
    bottom: 700,
    height: 610,
    left: 0,
    top: 90,
    width: 400
  },
  screenHeight: 800,
  screenWidth: 400
}

describe('hosted terminal link locator', () => {
  it('maps fixed cursor-relative rows through the resized xterm grid', () => {
    expect(hostedTerminalLinkPointsFromGeometry(geometry)).toEqual({
      javascript: { x: 0.0875, y: 0.530625 },
      file: { x: 0.0875, y: 0.606875 },
      http: { x: 0.0875, y: 0.683125 }
    })
  })

  it('fails when the rendered cell geometry cannot describe the screen', () => {
    expect(() =>
      hostedTerminalLinkPointsFromGeometry({
        ...geometry,
        cellHeight: 70
      })
    ).toThrow('grid is invalid')
  })

  it('reports the DOM target under a normalized emulator point', async () => {
    const evaluate = async (_document: unknown, expression: string) => {
      expect(expression).toContain('"x":0.25')
      expect(expression).toContain('document.elementFromPoint')
      return JSON.stringify({ clientX: 100, clientY: 200, terminalHit: true })
    }

    await expect(
      describeHostedTerminalLinkPoint({}, { x: 0.25, y: 0.5 }, { evaluate })
    ).resolves.toEqual({
      clientX: 100,
      clientY: 200,
      terminalHit: true
    })
  })
})
