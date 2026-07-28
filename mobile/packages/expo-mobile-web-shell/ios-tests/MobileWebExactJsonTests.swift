import Foundation

enum MobileWebExactJsonTests {
  static func run() {
    let valid = [
      "{}",
      #"{"a":1,"b":[true,false,null,{"c":"\u0063"}]}"#,
      #"{"a":-1.25e+2}"#,
    ]
    precondition(valid.allSatisfy(isExactMobileWebJsonDocument))

    let deeplyNested =
      String(repeating: #"{"a":"#, count: 34)
      + "0"
      + String(repeating: "}", count: 34)
    let invalid = [
      "",
      #"{"a":1} trailing"#,
      #"{"a":1,"a":1}"#,
      #"{"a":1,"\u0061":2}"#,
      #"{"a":{"b":1,"b":2}}"#,
      #"[{"a":1,"a":2}]"#,
      #"{"a":01}"#,
      #"{"a":+1}"#,
      #"{"a":1٢}"#,
      #"{"a":1,}"#,
      #"{"a":"\x"}"#,
      deeplyNested,
    ]
    precondition(invalid.allSatisfy { !isExactMobileWebJsonDocument($0) })
  }
}
