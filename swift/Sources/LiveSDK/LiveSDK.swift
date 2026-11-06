import Foundation
import Observation

public typealias TokenProvider = @Sendable () async throws -> String

public enum LiveSDKError: Error, Sendable, Hashable {
    case notConfigured
    case tokenUnavailable
    case network
    case server(code: String, message: String)
}

@MainActor
@Observable
public final class LiveSDK {
    private let environment: LiveSDKEnvironment
    public private(set) var config = LiveConfig.defaults
    private var configETag: String?
    private var configFetchedAt: Date?
    private var connection: (serverURL: URL, tokenProvider: TokenProvider)?

    public static let shared = LiveSDK()

    public init(environment: LiveSDKEnvironment = .live()) {
        self.environment = environment
    }

    public func configure(serverURL: URL, tokenProvider: @escaping TokenProvider) async {
        connection = (serverURL, tokenProvider)
        config = .defaults
        configETag = nil
        configFetchedAt = nil
        await refreshConfig()
    }

    public func lives() async throws(LiveSDKError) -> [LiveSummary] {
        try await call(LivesListResponse.self, "GET", "v1/lives").lives
    }

    public func startLive(title: String? = nil) async throws(LiveSDKError) -> LiveSummary {
        let body = try? WireCoding.encode(LivesCreateRequest(title: title))
        return try await call(LivesCreateResponse.self, "POST", "v1/lives", body: body).live
    }

    public func openLive(id: String) async throws(LiveSDKError) -> LiveSession {
        guard let connection else { throw .notConfigured }
        if isConfigStale {
            await refreshConfig()
        }
        let session = LiveSession(
            id: id,
            url: Self.webSocketURL(serverURL: connection.serverURL, liveId: id),
            config: config,
            tokenProvider: connection.tokenProvider,
            environment: environment
        )
        session.start()
        return session
    }

    private static func webSocketURL(serverURL: URL, liveId: String) -> URL {
        let url = serverURL.appending(path: "v1/lives").appending(path: liveId).appending(path: "ws")
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        components.scheme = components.scheme == "http" ? "ws" : "wss"
        return components.url ?? url
    }

    private static let configMaxAge: TimeInterval = 5 * 60

    private var isConfigStale: Bool {
        guard let configFetchedAt else { return true }
        return environment.clock.now.timeIntervalSince(configFetchedAt) > Self.configMaxAge
    }

    private func refreshConfig() async {
        configFetchedAt = environment.clock.now
        let conditional = configETag.map { ["If-None-Match": $0] } ?? [:]
        guard let response = try? await send("GET", "v1/config", headers: conditional) else { return }
        switch response.status {
        case 200:
            guard let served = try? WireCoding.decode(ServedConfig.self, from: response.body) else { return }
            config = served.resolved(over: .defaults)
            configETag = response.header("ETag")
        default:
            return
        }
    }

    private func call<Response: Decodable>(_ type: Response.Type, _ method: String, _ path: String, body: Data? = nil) async throws(LiveSDKError) -> Response {
        let response = try await send(method, path, body: body)
        guard (200..<300).contains(response.status) else {
            let detail = try? WireCoding.decode(HTTPErrorBody.self, from: response.body).error
            throw .server(code: detail?.code ?? "http_\(response.status)", message: detail?.message ?? "")
        }
        do { return try WireCoding.decode(type, from: response.body) } catch { throw .network }
    }

    private func send(_ method: String, _ path: String, body: Data? = nil, headers extra: [String: String] = [:]) async throws(LiveSDKError) -> HTTPResponse {
        guard let connection else { throw .notConfigured }
        let token: String
        do { token = try await connection.tokenProvider() } catch { throw .tokenUnavailable }
        let request = HTTPRequest(
            method: method,
            url: connection.serverURL.appending(path: path),
            headers: extra.merging(
                body == nil
                    ? ["Authorization": "Bearer \(token)"]
                    : ["Authorization": "Bearer \(token)", "Content-Type": "application/json"]
            ) { _, required in required },
            body: body
        )
        do { return try await environment.http.send(request) } catch { throw .network }
    }
}
