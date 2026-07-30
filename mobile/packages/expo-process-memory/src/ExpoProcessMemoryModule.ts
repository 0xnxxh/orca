import { requireNativeModule } from 'expo-modules-core'
import type { NativeProcessMemoryMeasurement } from './process-memory-measurement'

type ExpoProcessMemoryModule = {
  getProcessMemory(): NativeProcessMemoryMeasurement
}

export default requireNativeModule<ExpoProcessMemoryModule>('ExpoProcessMemory')
