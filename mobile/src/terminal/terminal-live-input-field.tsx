import { forwardRef } from 'react'
import { Platform, TextInput, requireNativeComponent, type TextInputProps } from 'react-native'
import type { TerminalLiveInputChangeEvent } from './use-terminal-live-input-commit'

type TerminalLiveInputFieldProps = Omit<TextInputProps, 'onChange'> & {
  readonly onChange: (event: TerminalLiveInputChangeEvent) => void
}

type AndroidTerminalInputProps = Omit<TerminalLiveInputFieldProps, 'onChange'> & {
  readonly onTerminalInput: TerminalLiveInputFieldProps['onChange']
}

const AndroidTerminalInput =
  Platform.OS === 'android'
    ? requireNativeComponent<AndroidTerminalInputProps>('OrcaTerminalInput')
    : null

export const TerminalLiveInputField = forwardRef<TextInput, TerminalLiveInputFieldProps>(
  function TerminalLiveInputField({ onChange, ...props }, ref) {
    if (AndroidTerminalInput) {
      return <AndroidTerminalInput {...props} ref={ref as never} onTerminalInput={onChange} />
    }
    return <TextInput {...props} ref={ref} onChange={onChange as TextInputProps['onChange']} />
  }
)
