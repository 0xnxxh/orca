import { WebSocket } from 'ws'
import { evaluateHostedDocumentWithRetry } from './hosted-webview-cdp-session.mjs'

const LINK_COLUMN = 3
const LINK_ROW_DELTAS_FROM_CURSOR = {
  javascript: 10,
  file: 7,
  http: 4
}

export async function readHostedTerminalLinkPoints(document, operations = {}) {
  const evaluate = operations.evaluate ?? evaluateHostedDocumentWithRetry
  const geometry = JSON.parse(
    await evaluate(
      document,
      `(() => {
        const terminal = document.querySelector('.xterm');
        const screenElement = document.querySelector('.xterm-screen');
        const textarea = document.querySelector('.xterm-helper-textarea');
        const terminalRect = terminal?.getBoundingClientRect();
        const screenRect = screenElement?.getBoundingClientRect();
        if (!(terminal instanceof HTMLElement) ||
            !(screenElement instanceof HTMLElement) ||
            !(textarea instanceof HTMLTextAreaElement) ||
            !terminalRect ||
            !screenRect ||
            terminalRect.width <= 0 ||
            terminalRect.height <= 0 ||
            screenRect.width <= 0 ||
            screenRect.height <= 0) return '';
        return JSON.stringify({
          cellHeight: Number.parseFloat(textarea.style.height),
          cellWidth: Number.parseFloat(textarea.style.width),
          cursorTop: Number.parseFloat(textarea.style.top),
          innerHeight: Number(innerHeight),
          screenRect: {
            height: screenRect.height,
            width: screenRect.width
          },
          terminalRect: {
            bottom: terminalRect.bottom,
            height: terminalRect.height,
            left: terminalRect.left,
            top: terminalRect.top,
            width: terminalRect.width
          },
          screenHeight: Number(screen.height),
          screenWidth: Number(screen.width)
        });
      })()`,
      WebSocket
    )
  )
  return hostedTerminalLinkPointsFromGeometry(geometry)
}

export async function describeHostedTerminalLinkPoint(document, point, operations = {}) {
  const evaluate = operations.evaluate ?? evaluateHostedDocumentWithRetry
  const value = await evaluate(
    document,
    `(() => {
      const point = ${JSON.stringify(point)};
      const viewportTop = Math.max(0, screen.height - innerHeight);
      const clientX = point.x * screen.width;
      const clientY = point.y * screen.height - viewportTop;
      const target = document.elementFromPoint(clientX, clientY);
      return JSON.stringify({
        clientX,
        clientY,
        className: typeof target?.className === 'string' ? target.className : '',
        screenHeight: screen.height,
        screenWidth: screen.width,
        tagName: target?.tagName ?? null,
        terminalHit: Boolean(target?.closest('.xterm')),
        viewportTop
      });
    })()`,
    WebSocket
  )
  return JSON.parse(value)
}

export function hostedTerminalLinkPointsFromGeometry(geometry) {
  validateGeometry(geometry)
  const columns = Math.round(geometry.screenRect.width / geometry.cellWidth)
  const rows = Math.round(geometry.screenRect.height / geometry.cellHeight)
  const cursorRow = Math.round(geometry.cursorTop / geometry.cellHeight)
  if (
    columns <= LINK_COLUMN ||
    rows <= LINK_ROW_DELTAS_FROM_CURSOR.javascript ||
    cursorRow < LINK_ROW_DELTAS_FROM_CURSOR.javascript ||
    cursorRow >= rows ||
    Math.abs(columns * geometry.cellWidth - geometry.screenRect.width) > geometry.cellWidth ||
    Math.abs(rows * geometry.cellHeight - geometry.screenRect.height) > geometry.cellHeight ||
    Math.abs(cursorRow * geometry.cellHeight - geometry.cursorTop) > geometry.cellHeight / 2
  ) {
    throw new Error('Hosted terminal link grid is invalid')
  }
  const viewportTop = Math.max(0, geometry.screenHeight - geometry.innerHeight)
  const cellWidth = geometry.terminalRect.width / columns
  const cellHeight = geometry.terminalRect.height / rows
  const point = (rowDeltaFromCursor) => ({
    x: (geometry.terminalRect.left + (LINK_COLUMN + 0.5) * cellWidth) / geometry.screenWidth,
    y:
      (viewportTop +
        geometry.terminalRect.top +
        (cursorRow - rowDeltaFromCursor + 0.5) * cellHeight) /
      geometry.screenHeight
  })
  const points = {
    javascript: point(LINK_ROW_DELTAS_FROM_CURSOR.javascript),
    file: point(LINK_ROW_DELTAS_FROM_CURSOR.file),
    http: point(LINK_ROW_DELTAS_FROM_CURSOR.http)
  }
  for (const candidate of Object.values(points)) {
    if (
      !Number.isFinite(candidate.x) ||
      !Number.isFinite(candidate.y) ||
      candidate.x < 0 ||
      candidate.x > 1 ||
      candidate.y < 0 ||
      candidate.y > 1
    ) {
      throw new Error('Hosted terminal link point is invalid')
    }
  }
  return points
}

function validateGeometry(geometry) {
  const values = [
    geometry?.cellHeight,
    geometry?.cellWidth,
    geometry?.cursorTop,
    geometry?.innerHeight,
    geometry?.screenHeight,
    geometry?.screenWidth,
    geometry?.screenRect?.height,
    geometry?.screenRect?.width,
    geometry?.terminalRect?.bottom,
    geometry?.terminalRect?.height,
    geometry?.terminalRect?.left,
    geometry?.terminalRect?.top,
    geometry?.terminalRect?.width
  ]
  if (
    values.some((value) => !Number.isFinite(value)) ||
    geometry.cellHeight <= 0 ||
    geometry.cellWidth <= 0 ||
    geometry.screenHeight <= 0 ||
    geometry.screenWidth <= 0 ||
    geometry.screenRect.height <= 0 ||
    geometry.screenRect.width <= 0 ||
    geometry.terminalRect.height <= 0 ||
    geometry.terminalRect.width <= 0
  ) {
    throw new Error('Hosted terminal link surface was not found')
  }
}
