import { t } from '@/i18n/mobile-i18n'
import type { TerminalAccessoryKey } from './terminal-accessory-keys'

export const TERMINAL_ACCESSORY_KEYS: TerminalAccessoryKey[] = [
  {
    id: 'escape',
    label: t('terminalAccessoryKeyCatalog.esc'),
    bytes: '\x1b',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.escape')
  },
  {
    id: 'tab',
    label: t('terminalAccessoryKeyCatalog.tab'),
    bytes: '\t',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.tab')
  },
  {
    id: 'enter',
    label: t('terminalAccessoryKeyCatalog.enter'),
    bytes: '\r',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.enter')
  },
  // Why: terminal apps recognize ESC [ Z as the reverse-tab sequence.
  {
    id: 'shiftTab',
    label: t('terminalAccessoryKeyCatalog.shiftPlus'),
    bytes: '\x1b[Z',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.shiftTab')
  },
  {
    id: 'space',
    label: t('terminalAccessoryKeyCatalog.space'),
    bytes: ' ',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.space')
  },
  {
    id: 'backspace',
    label: '⌫',
    bytes: '\x7f',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.backspace'),
    repeatable: true
  },
  {
    id: 'delete',
    label: t('terminalAccessoryKeyCatalog.del'),
    bytes: '\x1b[3~',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.forward'),
    repeatable: true
  },
  {
    id: 'arrowUp',
    label: '↑',
    bytes: '\x1b[A',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.arrowUp'),
    repeatable: true
  },
  {
    id: 'arrowDown',
    label: '↓',
    bytes: '\x1b[B',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.arrowDown'),
    repeatable: true
  },
  {
    id: 'arrowLeft',
    label: '←',
    bytes: '\x1b[D',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.arrowLeft'),
    repeatable: true
  },
  {
    id: 'arrowRight',
    label: '→',
    bytes: '\x1b[C',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.arrowRight'),
    repeatable: true
  },
  {
    id: 'ctrlC',
    label: t('terminalAccessoryKeyCatalog.ctrlPlusC'),
    bytes: '\x03',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.interrupt')
  },
  {
    id: 'ctrlD',
    label: t('terminalAccessoryKeyCatalog.ctrlPlusD'),
    bytes: '\x04',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.send')
  },
  {
    id: 'ctrlL',
    label: t('terminalAccessoryKeyCatalog.ctrlPlusL'),
    bytes: '\x0c',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.clearScreen')
  },
  {
    id: 'ctrlZ',
    label: t('terminalAccessoryKeyCatalog.ctrlPlusZ'),
    bytes: '\x1a',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.suspend')
  },
  {
    id: 'ctrlR',
    label: t('terminalAccessoryKeyCatalog.ctrlPlusR'),
    bytes: '\x12',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.reverse')
  },
  {
    id: 'ctrlA',
    label: t('terminalAccessoryKeyCatalog.ctrlPlus'),
    bytes: '\x01',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.start')
  },
  {
    id: 'ctrlE',
    label: t('terminalAccessoryKeyCatalog.ctrlPlusE'),
    bytes: '\x05',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.end')
  },
  {
    id: 'ctrlW',
    label: t('terminalAccessoryKeyCatalog.ctrlPlusW'),
    bytes: '\x17',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.delete')
  },
  {
    id: 'ctrlU',
    label: t('terminalAccessoryKeyCatalog.ctrlPlusU'),
    bytes: '\x15',
    accessibilityLabel: t('terminalAccessoryKeyCatalog.clearLine')
  }
]
