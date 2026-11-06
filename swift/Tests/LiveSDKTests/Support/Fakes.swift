import Testing
import Foundation
import LiveSDK

final class FakeHTTP: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var routes: [String: [HTTPResponse]] = [:]
    private var recorded: [HTTPRequest] = []

    var requests: [HTTPRequest] { lock.withLock { recorded } }

    func requests(to path: String) -> [HTTPRequest] {
        requests.filter { $0.url.path == path }
    }

    func reply(_ method: String, _ path: String, status: Int = 200, headers: [String: String] = [:], body: Data = Data()) {
        lock.withLock { routes["\(method) \(path)", default: []].append(HTTPResponse(status: status, headers: headers, body: body)) }
    }

    func reply(_ method: String, _ path: String, status: Int = 200, headers: [String: String] = [:], fixture: String) throws {
        reply(method, path, status: status, headers: headers, body: try Fixtures.data(fixture))
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        try lock.withLock {
            recorded.append(request)
            let key = "\(request.method) \(request.url.path)"
            guard var queue = routes[key], !queue.isEmpty else { throw URLError(.cannotConnectToHost) }
            let response = queue.count > 1 ? queue.removeFirst() : queue[0]
            routes[key] = queue
            return response
        }
    }
}

final class TokenProvider: @unchecked Sendable {
    private let lock = NSLock()
    private var issued = 0

    var count: Int { lock.withLock { issued } }

    func next() -> String {
        lock.withLock {
            issued += 1
            return "jeton-\(issued)"
        }
    }
}

final class FakeClock: LiveClock, @unchecked Sendable {
    private struct Sleeper {
        let deadline: Date
        let continuation: CheckedContinuation<Void, Never>
    }

    private let lock = NSLock()
    private var current = Date(timeIntervalSince1970: 1_794_000_000)
    private var recordedSleeps: [Duration] = []
    private var holding = false
    private var sleepers: [Sleeper] = []

    var now: Date { lock.withLock { current } }
    var sleeps: [Duration] { lock.withLock { recordedSleeps } }

    func holdSleeps() { lock.withLock { holding = true } }

    func advance(by interval: TimeInterval) {
        let due = lock.withLock {
            current = current.addingTimeInterval(interval)
            let due = sleepers.filter { $0.deadline <= current }
            sleepers.removeAll { $0.deadline <= current }
            return due
        }
        due.forEach { $0.continuation.resume() }
    }

    func sleep(for duration: Duration) async throws {
        let held = lock.withLock {
            recordedSleeps.append(duration)
            return holding
        }
        guard held else {
            await Task.yield()
            return
        }
        let seconds = Double(duration.components.seconds) + Double(duration.components.attoseconds) / 1e18
        await withCheckedContinuation { continuation in
            lock.withLock {
                sleepers.append(Sleeper(deadline: current.addingTimeInterval(seconds), continuation: continuation))
            }
        }
    }
}

final class FakeMedia: MediaConnector, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []
    private var failuresLeft = 0
    private var publishFailuresLeft = 0
    private var gate: CheckedContinuation<Void, Never>?
    private var holding = false

    var events: [String] { lock.withLock { recorded } }
    var isHeld: Bool { lock.withLock { gate != nil } }

    func failNextConnects(_ count: Int) { lock.withLock { failuresLeft = count } }
    func failNextPublishes(_ count: Int) { lock.withLock { publishFailuresLeft = count } }
    func holdConnects() { lock.withLock { holding = true } }

    func releaseConnect() {
        let waiting = lock.withLock {
            holding = false
            defer { gate = nil }
            return gate
        }
        waiting?.resume()
    }

    func connect(url: URL, token: String) async throws {
        if lock.withLock({ holding }) {
            await withCheckedContinuation { continuation in lock.withLock { gate = continuation } }
        }
        try lock.withLock {
            recorded.append("connect \(url.absoluteString) \(token)")
            if failuresLeft > 0 {
                failuresLeft -= 1
                throw URLError(.cannotConnectToHost)
            }
        }
    }

    func publishCameraAndMicrophone() async throws {
        try lock.withLock {
            recorded.append("publish")
            if publishFailuresLeft > 0 {
                publishFailuresLeft -= 1
                throw URLError(.cannotConnectToHost)
            }
        }
    }

    func disconnect() async {
        lock.withLock { recorded.append("disconnect") }
    }
}

final class MediaFactory: @unchecked Sendable {
    private let lock = NSLock()
    private var made: [FakeMedia] = []
    private var prepared: [FakeMedia] = []

    var all: [FakeMedia] { lock.withLock { made } }

    func prepare(_ media: FakeMedia) { lock.withLock { prepared.append(media) } }

    func make() -> any MediaConnector {
        lock.withLock {
            let media = prepared.isEmpty ? FakeMedia() : prepared.removeFirst()
            made.append(media)
            return media
        }
    }
}

struct Harness {
    let http = FakeHTTP()
    let socket = FakeWebSocket()
    let clock = FakeClock()
    let medias = MediaFactory()
    let tokens = TokenProvider()
    let serverURL = URL(string: "https://live.test")!

    var environment: LiveSDKEnvironment {
        let medias = medias
        return LiveSDKEnvironment(http: http, webSocket: socket, clock: clock, makeMedia: { medias.make() })
    }

    var media: FakeMedia { medias.all.first ?? FakeMedia() }

    func connection(_ index: Int) async throws -> FakeConnection {
        let socket = socket
        _ = await eventually { socket.connections.count > index }
        return try #require(socket.connections.dropFirst(index).first)
    }

    @MainActor
    func configuredSDK() async -> LiveSDK {
        let sdk = LiveSDK(environment: environment)
        let tokens = tokens
        await sdk.configure(serverURL: serverURL) { tokens.next() }
        return sdk
    }
}
