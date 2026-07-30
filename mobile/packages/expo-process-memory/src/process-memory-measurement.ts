export type NativeProcessMemoryMeasurement = Readonly<{
  metric: 'physical-footprint' | 'proportional-set-size'
  value: number
  unit: 'bytes' | 'kibibytes'
  processRole: 'app'
  pid: number
  sampledAtMs: number
}>
