import Darwin
import ExpoModulesCore
import Foundation

public class ExpoProcessMemoryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoProcessMemory")

    Function("getProcessMemory") { () throws -> [String: Any] in
      var info = task_vm_info_data_t()
      var count = mach_msg_type_number_t(
        MemoryLayout<task_vm_info_data_t>.stride / MemoryLayout<integer_t>.stride
      )
      let status = withUnsafeMutablePointer(to: &info) { pointer in
        pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
          task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
      }
      guard status == KERN_SUCCESS else {
        throw NSError(domain: "ExpoProcessMemory", code: Int(status))
      }
      return [
        "metric": "physical-footprint",
        "value": Double(info.phys_footprint),
        "unit": "bytes",
        "processRole": "app",
        "pid": ProcessInfo.processInfo.processIdentifier,
        "sampledAtMs": Date().timeIntervalSince1970 * 1_000
      ]
    }
  }
}
