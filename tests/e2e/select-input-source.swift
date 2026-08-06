import Carbon

guard CommandLine.arguments.count == 2 else {
  exit(2)
}

let properties = [kTISPropertyInputSourceID: CommandLine.arguments[1] as CFString] as CFDictionary
let sources = TISCreateInputSourceList(properties, true).takeRetainedValue() as! [TISInputSource]
guard let source = sources.first else {
  exit(3)
}

TISEnableInputSource(source)
exit(TISSelectInputSource(source) == noErr ? 0 : 4)
