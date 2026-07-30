package expo.modules.processmemory

import android.os.Debug
import android.os.Process
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoProcessMemoryModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoProcessMemory")

    Function("getProcessMemory") {
      val memoryInfo = Debug.MemoryInfo()
      Debug.getMemoryInfo(memoryInfo)
      val totalPssKibibytes = memoryInfo.totalPss
      require(totalPssKibibytes >= 0) { "Process memory is unavailable" }
      mapOf(
        "metric" to "proportional-set-size",
        "value" to totalPssKibibytes.toDouble(),
        "unit" to "kibibytes",
        "processRole" to "app",
        "pid" to Process.myPid(),
        "sampledAtMs" to System.currentTimeMillis().toDouble()
      )
    }
  }
}
