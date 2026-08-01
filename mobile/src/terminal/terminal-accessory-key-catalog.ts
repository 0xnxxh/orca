import { t } from '@/i18n/mobile-i18n'
import type { TerminalAccessoryKey } from './terminal-accessory-keys'

export const TERMINAL_ACCESSORY_KEYS: TerminalAccessoryKey[] = [
  { id: 'escape', label: 'Esc', bytes: '\x1b', accessibilityLabel: t('m.jHe6UUU') },
  { id: 'tab', label: 'Tab', bytes: '\t', accessibilityLabel: t('m.hM5KUAw') },
  { id: 'enter', label: 'Enter', bytes: '\r', accessibilityLabel: t('m.9KFo5zM') },
  // Why: terminal apps recognize ESC [ Z as the reverse-tab sequence.
  { id: 'shiftTab', label: 'Shift+Tab', bytes: '\x1b[Z', accessibilityLabel: t('m.p7_d2FU') },
  { id: 'space', label: 'Space', bytes: ' ', accessibilityLabel: t('m.l6KJT3M') },
  {
    id: 'backspace',
    label: '⌫',
    bytes: '\x7f',
    accessibilityLabel: t('m.6TRPiic'),
    repeatable: true
  },
  {
    id: 'delete',
    label: 'Del',
    bytes: '\x1b[3~',
    accessibilityLabel: t('m.fNgDk9o'),
    repeatable: true
  },
  {
    id: 'arrowUp',
    label: '↑',
    bytes: '\x1b[A',
    accessibilityLabel: t('m.IwJi8TY'),
    repeatable: true
  },
  {
    id: 'arrowDown',
    label: '↓',
    bytes: '\x1b[B',
    accessibilityLabel: t('m.vVsy7qk'),
    repeatable: true
  },
  {
    id: 'arrowLeft',
    label: '←',
    bytes: '\x1b[D',
    accessibilityLabel: t('m.RiGIavM'),
    repeatable: true
  },
  {
    id: 'arrowRight',
    label: '→',
    bytes: '\x1b[C',
    accessibilityLabel: t('m.v5WSGO0'),
    repeatable: true
  },
  { id: 'ctrlC', label: 'Ctrl+C', bytes: '\x03', accessibilityLabel: t('m.AzHoQzM') },
  { id: 'ctrlD', label: 'Ctrl+D', bytes: '\x04', accessibilityLabel: t('m.PBPnPeQ') },
  { id: 'ctrlL', label: 'Ctrl+L', bytes: '\x0c', accessibilityLabel: t('m.Eqaj8oY') },
  { id: 'ctrlZ', label: 'Ctrl+Z', bytes: '\x1a', accessibilityLabel: t('m.hqWfNmA') },
  { id: 'ctrlR', label: 'Ctrl+R', bytes: '\x12', accessibilityLabel: t('m.mcvHf4o') },
  { id: 'ctrlA', label: 'Ctrl+A', bytes: '\x01', accessibilityLabel: t('m.CKFp_QM') },
  { id: 'ctrlE', label: 'Ctrl+E', bytes: '\x05', accessibilityLabel: t('m.0VWtVO8') },
  { id: 'ctrlW', label: 'Ctrl+W', bytes: '\x17', accessibilityLabel: t('m.Bd9qfdk') },
  { id: 'ctrlU', label: 'Ctrl+U', bytes: '\x15', accessibilityLabel: t('m.HrWsdDM') }
]
