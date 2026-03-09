import Foundation
import LocalAuthentication

let args = CommandLine.arguments
let reason = args.count > 1 ? args[1] : "Authenticate to unlock encrypted content"

let context = LAContext()
var error: NSError?

// --check flag: just report availability without prompting
if args.contains("--check") {
    if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
        print("available")
        exit(0)
    } else {
        print("unavailable")
        exit(2)
    }
}

guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
    print("unavailable")
    exit(2)
}

let semaphore = DispatchSemaphore(value: 0)
var succeeded = false

context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, _ in
    succeeded = success
    semaphore.signal()
}

semaphore.wait()

if succeeded {
    print("success")
    exit(0)
} else {
    print("fail")
    exit(1)
}
