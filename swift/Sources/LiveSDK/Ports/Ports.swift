import Foundation

public struct HTTPRequest: Sendable, Hashable {
    public let method: String
    public let url: URL
    public let headers: [String: String]
    public let body: Data?

    public init(method: String, url: URL, headers: [String: String] = [:], body: Data? = nil) {
        self.method = method
        self.url = url
        self.headers = headers
        self.body = body
    }
}

public struct HTTPResponse: Sendable, Hashable {
    public let status: Int
    public let headers: [String: String]
    public let body: Data

    public init(status: Int, headers: [String: String] = [:], body: Data = Data()) {
        self.status = status
        self.headers = headers
        self.body = body
    }

    public func header(_ name: String) -> String? {
        headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
    }
}

public protocol HTTPTransport: Sendable {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse
}

public protocol WebSocketConnection: Sendable {
    func send(_ text: String) async throws
    func receive() async throws -> String
    func close()
}

public protocol WebSocketTransport: Sendable {
    func connect(to url: URL) async throws -> any WebSocketConnection
}

public protocol LiveClock: Sendable {
    var now: Date { get }
    func sleep(for duration: Duration) async throws
}

public protocol MediaConnector: Sendable {
    func connect(url: URL, token: String) async throws
    func publishCameraAndMicrophone() async throws
    func unpublishCameraAndMicrophone() async throws
    func disconnect() async
}

public struct LiveSDKEnvironment: Sendable {
    public let http: any HTTPTransport
    public let webSocket: any WebSocketTransport
    public let clock: any LiveClock
    public let makeMedia: @Sendable () -> any MediaConnector

    public init(
        http: any HTTPTransport,
        webSocket: any WebSocketTransport,
        clock: any LiveClock,
        makeMedia: @escaping @Sendable () -> any MediaConnector
    ) {
        self.http = http
        self.webSocket = webSocket
        self.clock = clock
        self.makeMedia = makeMedia
    }
}

extension LiveSDKEnvironment {
    public static func live(session: URLSession = .shared) -> LiveSDKEnvironment {
        LiveSDKEnvironment(
            http: URLSessionHTTPTransport(session: session),
            webSocket: URLSessionWebSocketTransport(session: session),
            clock: SystemClock(),
            makeMedia: { LiveKitMediaConnector() }
        )
    }
}
