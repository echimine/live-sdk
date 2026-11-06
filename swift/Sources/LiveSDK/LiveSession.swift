import Foundation
import Observation

public enum LiveStatus: Sendable, Hashable {
    case connecting
    case connected
    case reconnecting
    case ended(LiveEndReason, LiveRecap?)
    case replaced
    case banned
    case failed(LiveErrorCode)
    case left

    var isFinal: Bool {
        switch self {
        case .ended, .replaced, .banned, .failed, .left: true
        case .connecting, .connected, .reconnecting: false
        }
    }
}

@MainActor
@Observable
public final class LiveSession {
    public let id: String
    public private(set) var status = LiveStatus.connecting
    public private(set) var title: String?
    public private(set) var startedAt: Date?
    public private(set) var you: Participant?
    public private(set) var role: Role?
    public private(set) var host: Participant?
    public private(set) var hostConnected = false
    public private(set) var cohosts: [Participant] = []
    public private(set) var pinnedProduct: Product?
    public private(set) var audience = Audience.empty
    public private(set) var reactionsTotal = 0
    public private(set) var messages: [ChatMessage] = []
    public private(set) var joinRequests: [Participant] = []
    public private(set) var moderation: Moderation?

    private let url: URL
    private let tokenProvider: TokenProvider
    private let environment: LiveSDKEnvironment
    private var task: Task<Void, Never>?
    private var connection: (any WebSocketConnection)?
    private var lastRef = 0
    private var failures = 0
    private var mediaConnected = false
    private let media: any MediaConnector
    private var outbox: Task<Void, Never>?
    private var pending: [String: CheckedContinuation<Result<Void, LiveCommandError>, Never>] = [:]

    init(id: String, url: URL, tokenProvider: @escaping TokenProvider, environment: LiveSDKEnvironment) {
        self.id = id
        self.url = url
        self.tokenProvider = tokenProvider
        self.environment = environment
        self.media = environment.makeMedia()
    }

    func start() {
        task = Task { [weak self] in await self?.run() }
    }

    public func leave() async {
        guard !status.isFinal else { return }
        task?.cancel()
        await finish(.left)
    }

    public func send(_ command: LiveCommand) async throws(LiveCommandError) {
        let ref = nextRef()
        guard status == .connected, let connection, let text = try? Self.encode(.command(ref: ref, command)) else {
            throw LiveCommandError(code: .disconnected, message: "")
        }
        let result = await withCheckedContinuation { continuation in
            pending[ref] = continuation
            let previous = outbox
            outbox = Task { [weak self] in
                await previous?.value
                do {
                    try await connection.send(text)
                } catch {
                    self?.resolve(ref, with: .failure(LiveCommandError(code: .disconnected, message: "")))
                }
            }
        }
        try result.get()
    }

    private func resolve(_ ref: String, with result: Result<Void, LiveCommandError>) {
        pending.removeValue(forKey: ref)?.resume(returning: result)
    }

    private func nextRef() -> String {
        lastRef += 1
        return "c\(lastRef)"
    }

    private static func encode(_ message: ClientMessage) throws -> String {
        String(decoding: try WireCoding.encode(message), as: UTF8.self)
    }

    private func run() async {
        while !status.isFinal && !Task.isCancelled {
            if failures > 0 {
                try? await environment.clock.sleep(for: Self.backoff(afterFailures: failures))
                if status.isFinal || Task.isCancelled { return }
            }
            if let connection = await open() {
                await listen(on: connection)
            }
            if status.isFinal { return }
            failures += 1
            dropConnection()
        }
    }

    static func backoff(afterFailures failures: Int) -> Duration {
        .seconds(min(10, 1 << min(failures - 1, 4)))
    }

    private func open() async -> (any WebSocketConnection)? {
        guard let token = try? await tokenProvider(),
              let join = try? Self.encode(.join(token: token)),
              let connection = try? await environment.webSocket.connect(to: url)
        else { return nil }
        guard !status.isFinal else {
            connection.close()
            return nil
        }
        do { try await connection.send(join) } catch { return nil }
        self.connection = connection
        return connection
    }

    private func listen(on connection: any WebSocketConnection) async {
        while !status.isFinal, let text = try? await connection.receive() {
            guard let message = try? WireCoding.decode(ServerMessage.self, from: Data(text.utf8)) else { continue }
            await handle(message)
        }
    }

    private func dropConnection() {
        connection?.close()
        connection = nil
        status = .reconnecting
        failPendingCommands()
    }

    private func failPendingCommands() {
        let waiting = pending.values
        pending = [:]
        waiting.forEach { $0.resume(returning: .failure(LiveCommandError(code: .disconnected, message: ""))) }
    }

    private func handle(_ message: ServerMessage) async {
        switch message {
        case .snapshot(let snapshot):
            apply(snapshot)
            failures = 0
            status = .connected
            await connectMedia(snapshot.livekit)
        case .ack(let ref):
            resolve(ref, with: .success(()))
        case .error(let error):
            guard let ref = error.ref else {
                await refuseJoin(error.code)
                break
            }
            let failure = LiveCommandError(
                code: error.code,
                message: error.message,
                retryAfter: error.retryAfterMs.map { .milliseconds($0) }
            )
            resolve(ref, with: .failure(failure))
        case .liveEnded(let ended):
            await finish(.ended(ended.reason, ended.summary))
        case .replaced:
            await finish(.replaced)
        case .banned:
            await finish(.banned)
        case .audience(let update):
            audience = update
        case .chatMessage(let message):
            messages.append(message)
        case .messageDeleted(let messageId):
            messages.removeAll { $0.id == messageId }
        case .productPinned(let product):
            pinnedProduct = product
        case .productUnpinned:
            pinnedProduct = nil
        case .reactions(let update):
            reactionsTotal = update.total
        case .hostDisconnected:
            hostConnected = false
        case .hostReconnected:
            hostConnected = true
        case .roleChanged(let change):
            apply(change)
        case .joinRequested(let participant):
            joinRequests = joinRequests.filter { $0.id != participant.id } + [participant]
        case .joinRequestCancelled(let participantId):
            joinRequests.removeAll { $0.id == participantId }
        case .moderationChanged(let lists):
            moderation = lists
        default:
            break
        }
    }

    private func refuseJoin(_ code: LiveErrorCode) async {
        guard status != .connected else { return }
        switch code {
        case .banned:
            await finish(.banned)
        case .liveNotFound, .invalidToken:
            await finish(.failed(code))
        default:
            connection?.close()
        }
    }

    private func connectMedia(_ livekit: Snapshot.LiveKit) async {
        guard !mediaConnected else { return }
        do {
            try await media.connect(url: livekit.url, token: livekit.token)
            mediaConnected = true
        } catch {
            return
        }
        if status.isFinal {
            await media.disconnect()
        }
    }

    private func finish(_ final: LiveStatus) async {
        status = final
        failPendingCommands()
        connection?.close()
        connection = nil
        await media.disconnect()
    }

    private func apply(_ change: RoleChanged) {
        let others = cohosts.filter { $0.id != change.participant.id }
        cohosts = change.role == .cohost ? others + [change.participant] : others
        if change.participant.id == you?.id {
            role = change.role
        }
    }

    private func apply(_ snapshot: Snapshot) {
        title = snapshot.live.title
        startedAt = snapshot.live.startedAt
        you = snapshot.you
        role = snapshot.role
        host = snapshot.host
        hostConnected = snapshot.hostConnected
        cohosts = snapshot.cohosts
        pinnedProduct = snapshot.pinnedProduct
        audience = snapshot.audience
        reactionsTotal = snapshot.reactionsTotal
        messages = snapshot.messages
        joinRequests = snapshot.joinRequests ?? []
        moderation = snapshot.moderation
    }
}
