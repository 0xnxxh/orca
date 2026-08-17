import CoreFoundation
import Foundation

public struct AttributeValueCoercion: Equatable {
    public enum Value: Equatable {
        case string(String)
        case integer(Int64)
        case double(Double)
        case boolean(Bool)

        public var preview: String {
            switch self {
            case let .string(value):
                return value
            case let .integer(value):
                return String(value)
            case let .double(value):
                return String(value)
            case let .boolean(value):
                return String(value)
            }
        }
    }

    public enum ReadbackComparison: Equatable {
        case match(actualPreview: String)
        case mismatch(actualPreview: String)
        case unsupported
    }

    public let writeValue: Value

    public init(existingValue: CFTypeRef?, requested: String) {
        guard let existingValue, let current = Self.decode(existingValue) else {
            writeValue = .string(requested)
            return
        }

        writeValue = Self.coerce(requested, matching: current) ?? .string(requested)
    }

    public func compare(readback: CFTypeRef?) -> ReadbackComparison {
        guard let readback, let actual = Self.decode(readback) else {
            return .unsupported
        }
        return actual == writeValue
            ? .match(actualPreview: actual.preview)
            : .mismatch(actualPreview: actual.preview)
    }

    private static func coerce(_ requested: String, matching current: Value) -> Value? {
        let trimmed = requested.trimmingCharacters(in: .whitespacesAndNewlines)
        switch current {
        case .string:
            return .string(requested)
        case .integer:
            if let value = Int64(trimmed) {
                return .integer(value)
            }
            guard let value = Double(trimmed), value.isFinite, let integer = Int64(exactly: value) else {
                return nil
            }
            return .integer(integer)
        case .double:
            guard let value = Double(trimmed), value.isFinite else { return nil }
            return .double(value)
        case .boolean:
            switch trimmed.lowercased() {
            case "true", "1":
                return .boolean(true)
            case "false", "0":
                return .boolean(false)
            default:
                return nil
            }
        }
    }

    private static func decode(_ value: CFTypeRef) -> Value? {
        let typeID = CFGetTypeID(value)
        if typeID == CFStringGetTypeID() {
            return (value as? String).map(Value.string)
        }
        if typeID == CFBooleanGetTypeID() {
            return (value as? Bool).map(Value.boolean)
        }
        guard typeID == CFNumberGetTypeID() else { return nil }

        let number = unsafeDowncast(value, to: CFNumber.self)
        if CFNumberIsFloatType(number) {
            var decoded = 0.0
            guard CFNumberGetValue(number, .doubleType, &decoded), decoded.isFinite else { return nil }
            return .double(decoded)
        }

        var decoded: Int64 = 0
        guard CFNumberGetValue(number, .sInt64Type, &decoded) else { return nil }
        return .integer(decoded)
    }
}
