import Foundation
import LiveSDK

final class FakeWebSocket: WebSocketTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var opened: [FakeConnection] = []
    private var failuresLeft = 0
    private var attempts: [URL] = []

    var connections: [FakeConnection] { lock.withLock { opened } }
    var connectAttempts: [URL] { lock.withLock { attempts } }

    func failNextConnections(_ count: Int) {
        lock.withLock { failuresLeft = count }
    }

    func connect(to url: URL) async throws -> any WebSocketConnection {
        try lock.withLock {
            attempts.append(url)
            if failuresLeft > 0 {
                failuresLeft -= 1
                throw URLError(.networkConnectionLost)
            }
            let connection = FakeConnection(url: url)
            opened.append(connection)
            return connection
        }
    }
}

final class FakeConnection: WebSocketConnection, @unchecked Sendable {
    let url: URL
    private let lock = NSLock()
    private var outgoing: [String] = []
    private var isClosed = false
    private var sendsFail = false
    private let incoming: AsyncThrowingStream<String, Error>
    private let continuation: AsyncThrowingStream<String, Error>.Continuation
    private var iterator: AsyncThrowingStream<String, Error>.AsyncIterator

    init(url: URL) {
        self.url = url
        (incoming, continuation) = AsyncThrowingStream.makeStream()
        iterator = incoming.makeAsyncIterator()
    }

    var sent: [String] { lock.withLock { outgoing } }
    var sentJSON: [JSONValue] { sent.compactMap { try? JSONValue.parse(Data($0.utf8)) } }
    var closed: Bool { lock.withLock { isClosed } }

    func push(_ text: String) { continuation.yield(text) }
    func push(fixture: String) throws { push(try Fixtures.text(fixture)) }
    func failSends() { lock.withLock { sendsFail = true } }
    func drop() { continuation.finish(throwing: URLError(.networkConnectionLost)) }

    func send(_ text: String) async throws {
        try lock.withLock {
            if isClosed || sendsFail { throw URLError(.networkConnectionLost) }
            outgoing.append(text)
        }
    }

    func receive() async throws -> String {
        var current = lock.withLock { iterator }
        guard let next = try await current.next() else { throw URLError(.networkConnectionLost) }
        lock.withLock { iterator = current }
        return next
    }

    func close() {
        lock.withLock { isClosed = true }
        continuation.finish()
    }
}

func eventually(timeout: Duration = .seconds(2), _ condition: @MainActor () -> Bool) async -> Bool {
    let deadline = ContinuousClock.now.advanced(by: timeout)
    while ContinuousClock.now < deadline {
        if await condition() { return true }
        try? await Task.sleep(for: .milliseconds(2))
    }
    return await condition()
}
