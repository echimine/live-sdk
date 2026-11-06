import Foundation

struct SystemClock: LiveClock {
    var now: Date { Date() }

    func sleep(for duration: Duration) async throws {
        try await Task.sleep(for: duration)
    }
}
