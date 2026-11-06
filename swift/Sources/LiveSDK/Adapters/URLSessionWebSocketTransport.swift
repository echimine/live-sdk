import Foundation

struct URLSessionWebSocketTransport: WebSocketTransport {
    let session: URLSession

    func connect(to url: URL) async throws -> any WebSocketConnection {
        let task = session.webSocketTask(with: url)
        task.resume()
        return URLSessionWebSocketConnection(task: task)
    }
}

private final class URLSessionWebSocketConnection: WebSocketConnection, @unchecked Sendable {
    private let task: URLSessionWebSocketTask

    init(task: URLSessionWebSocketTask) {
        self.task = task
    }

    func send(_ text: String) async throws {
        try await task.send(.string(text))
    }

    func receive() async throws -> String {
        switch try await task.receive() {
        case .string(let text): return text
        case .data(let data): return String(decoding: data, as: UTF8.self)
        @unknown default: return ""
        }
    }

    func close() {
        task.cancel(with: .normalClosure, reason: nil)
    }
}
