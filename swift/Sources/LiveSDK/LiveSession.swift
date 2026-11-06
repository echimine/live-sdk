import Foundation
import LiveKit
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

public enum LiveEvent: Sendable, Hashable {
    case reactions([String: Int])
    case purchase(ChatMessage)
    /// Spectateur : l'Hôte a refusé ma Demande de montée (`joinRequestPending` repasse à `false`).
    case joinDeclined
}

@MainActor
@Observable
public final class LiveSession {
    public nonisolated let id: String
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
    /// Ma Demande de montée attend la réponse de l'Hôte : effacée à la montée, au refus (`joinDeclined`,
    /// annoncé par `LiveEvent.joinDeclined`) ou à une reconnexion.
    public private(set) var joinRequestPending = false
    public private(set) var moderation: Moderation?
    public private(set) var chatLocked = false
    /// Fin du verrou du chat posé après un `rate_limited` (`nil` sans verrou) ; voir aussi `chatLockRemaining`.
    public private(set) var chatUnlockAt: Date?

    /// Limite fixée par le serveur : une 6e acceptation est refusée (`cohost_limit`).
    public nonisolated static let maxCohosts = 5

    /// À l'écran, dans l'ordre de la mosaïque : l'Hôte, puis les Co-hôtes par ordre de montée.
    public var stage: [Participant] {
        (host.map { [$0] } ?? []) + cohosts
    }

    private let url: URL
    private let tokenProvider: TokenProvider
    private let environment: LiveSDKEnvironment
    private var task: Task<Void, Never>?
    private var connection: (any WebSocketConnection)?
    private var lastRef = 0
    private var failures = 0
    private var mediaConnected = false
    private var mediaPublished = false
    private var eventContinuations: [UUID: AsyncStream<LiveEvent>.Continuation] = [:]
    private var ownReactionsSinceLastWindow: [String: Int] = [:]
    private var ownReactionsCarried: [String: Int] = [:]
    private var chatUnlockTask: Task<Void, Never>?
    /// Un `invalid_token` au `join` est retenté une fois avec un jeton frais avant d'échouer.
    private var retriedInvalidToken = false
    private let media: any MediaConnector
    private var outbox: Task<Void, Never>?
    private var pending: [String: CheckedContinuation<Result<Void, LiveCommandError>, Never>] = [:]
    private var sentCommands: [String: LiveCommand] = [:]

    public let config: LiveConfig

    init(id: String, url: URL, config: LiveConfig, tokenProvider: @escaping TokenProvider, environment: LiveSDKEnvironment) {
        self.id = id
        self.config = config
        self.url = url
        self.tokenProvider = tokenProvider
        self.environment = environment
        self.media = environment.makeMedia()
    }

    package var mediaRoom: Room? {
        (media as? LiveKitMediaConnector)?.room
    }

    func start() {
        task = Task { [weak self] in await self?.run() }
    }

    public func leave() async {
        guard !status.isFinal else { return }
        task?.cancel()
        await finish(.left)
    }

    /// Réduit la photo (1 024 px au plus, JPEG) puis l'envoie à `POST /v1/images` ; rend son URL.
    func uploadProductImage(_ data: Data) async throws(LiveCommandError) -> URL {
        guard status == .connected else { throw LiveCommandError(code: .disconnected, message: "") }
        let encoded = try await Task.detached { Result { () throws(LiveCommandError) in try ProductImageEncoder.jpeg(data) } }.value.get()
        guard config.images.formats.contains("image/jpeg") else {
            throw LiveCommandError(code: .unsupportedMediaType, message: "Formats acceptés : \(config.images.formats.joined(separator: ", ")).")
        }
        guard encoded.count <= config.images.maxBytes else {
            throw LiveCommandError(code: .payloadTooLarge, message: "Image de plus de \(config.images.maxBytes / (1024 * 1024)) Mo.")
        }
        let token: String
        do { token = try await tokenProvider() } catch {
            LiveLog.http.error("Envoi de l’image impossible : jeton de Participant indisponible")
            throw LiveCommandError(code: .tokenUnavailable, message: "Impossible d’obtenir votre identité auprès de l’app.")
        }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "ws" ? "http" : "https"
        components.path = url.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appending(path: "images").path
        components.query = nil
        let request = HTTPRequest(method: "POST", url: components.url!, headers: ["Authorization": "Bearer \(token)", "Content-Type": "image/jpeg"], body: encoded)
        let response: HTTPResponse
        do { response = try await environment.http.send(request) } catch {
            LiveLog.http.error("Envoi de l’image impossible : serveur injoignable")
            throw LiveCommandError(code: .network, message: "Serveur injoignable. Vérifiez votre connexion.")
        }
        guard (200..<300).contains(response.status) else {
            LiveLog.http.error("Envoi de l’image refusé : HTTP \(response.status, privacy: .public)")
            throw Self.uploadError(response)
        }
        guard let uploaded = try? WireCoding.decode(ImagesUploadResponse.self, from: response.body) else {
            throw LiveCommandError(code: .network, message: "Réponse du serveur illisible.")
        }
        return uploaded.url
    }

    /// Code fermé d'un refus HTTP : celui du corps s'il est connu, sinon déduit du statut (comme le cœur Kotlin).
    private static func uploadError(_ response: HTTPResponse) -> LiveCommandError {
        let detail = try? WireCoding.decode(HTTPErrorBody.self, from: response.body).error
        let fromBody = detail.flatMap { LiveErrorCode(rawValue: $0.code) }
        let code: LiveErrorCode = if let fromBody, fromBody != .unknown { fromBody } else {
            switch response.status {
            case 401: .invalidToken
            case 404: .notFound
            case 413: .payloadTooLarge
            case 415: .unsupportedMediaType
            case 429: .rateLimited
            default: .network
            }
        }
        return LiveCommandError(code: code, message: detail?.message ?? "Envoi de l’image impossible.")
    }

    public func sendMessage(_ text: String) async throws(LiveCommandError) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let maxLength = config.chat.maxLength
        guard (1...maxLength).contains(trimmed.count) else {
            throw LiveCommandError(code: .invalidMessage, message: "Un message fait de 1 à \(maxLength) caractères visibles.")
        }
        if let remaining = chatLockRemaining {
            throw LiveCommandError(code: .rateLimited, message: "Doucement…", retryAfter: remaining)
        }
        do {
            try await send(.sendMessage(text: trimmed))
        } catch {
            if error.code == .rateLimited {
                lockChat(for: error.retryAfter ?? Self.defaultChatLock)
            }
            throw error
        }
    }

    private static let defaultChatLock = Duration.seconds(5)

    /// Temps restant du verrou du chat, `nil` quand le chat est ouvert.
    public var chatLockRemaining: Duration? {
        guard let chatUnlockAt else { return nil }
        let milliseconds = Int((chatUnlockAt.timeIntervalSince(environment.clock.now) * 1000).rounded())
        return milliseconds > 0 ? .milliseconds(milliseconds) : nil
    }

    private func lockChat(for duration: Duration) {
        let unlockAt = environment.clock.now.addingTimeInterval(duration.timeInterval)
        if let current = chatUnlockAt, current >= unlockAt { return }
        chatUnlockAt = unlockAt
        chatLocked = true
        chatUnlockTask?.cancel()
        let clock = environment.clock
        chatUnlockTask = Task { [weak self] in
            try? await clock.sleep(for: duration)
            guard let self, self.chatUnlockAt == unlockAt else { return }
            self.chatUnlockAt = nil
            self.chatLocked = false
        }
    }

    public func send(_ command: LiveCommand) async throws(LiveCommandError) {
        let ref = nextRef()
        guard status == .connected, let connection, let text = try? Self.encode(.command(ref: ref, command)) else {
            throw LiveCommandError(code: .disconnected, message: "")
        }
        let result = await withCheckedContinuation { continuation in
            pending[ref] = continuation
            sentCommands[ref] = command
            enqueue(text, on: connection) { [weak self] in
                self?.resolve(ref, with: .failure(LiveCommandError(code: .disconnected, message: "")))
            }
        }
        try result.get()
    }

    private func applyAcknowledged(_ command: LiveCommand) {
        switch command {
        case .requestToJoin: joinRequestPending = true
        case .cancelJoinRequest: joinRequestPending = false
        // Le serveur n'annonce pas un refus : la demande disparaît à l'ack.
        case .declineJoin(let participantId): joinRequests.removeAll { $0.id == participantId }
        default: break
        }
    }

    /// Les actions permises sur ce message à l'instant : aucune pour un Spectateur.
    public func moderationActions(for message: ChatMessage) -> [ModerationAction] {
        guard role == .host || role == .cohost else { return [] }
        let author = message.author.id
        // Le serveur ne laisse modérer ni l'Hôte, ni un Co-hôte sauf par l'Hôte (`not_animator`).
        let protected = author == host?.id || author == you?.id
            || (role != .host && cohosts.contains { $0.id == author })
        let banned = moderation?.banned.contains { $0.id == author } == true
        if protected || banned { return [.deleteMessage] }
        let shadowbanned = moderation?.shadowbanned.contains { $0.id == author } == true
        return [.deleteMessage, shadowbanned ? .unshadowban : .shadowban, .ban]
    }

    public func react(_ emoji: String) {
        guard config.reactions.contains(emoji), status == .connected, let connection,
              let text = try? Self.encode(.react(emoji: emoji))
        else { return }
        enqueue(text, on: connection) { [weak self] in
            self?.forgetOwnReaction(emoji)
        }
        ownReactionsSinceLastWindow[emoji, default: 0] += 1
        emit(.reactions([emoji: 1]))
    }

    private func forgetOwnReaction(_ emoji: String) {
        guard let count = ownReactionsSinceLastWindow[emoji] else { return }
        ownReactionsSinceLastWindow[emoji] = count > 1 ? count - 1 : nil
    }

    public func events() -> AsyncStream<LiveEvent> {
        let (stream, continuation) = AsyncStream<LiveEvent>.makeStream(bufferingPolicy: .bufferingNewest(64))
        guard !status.isFinal else {
            continuation.finish()
            return stream
        }
        let key = UUID()
        eventContinuations[key] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { @MainActor in self?.eventContinuations[key] = nil }
        }
        return stream
    }

    private func emit(_ event: LiveEvent) {
        eventContinuations.values.forEach { $0.yield(event) }
    }

    private func enqueue(_ text: String, on connection: any WebSocketConnection, onFailure: @escaping @MainActor () -> Void) {
        let previous = outbox
        outbox = Task {
            await previous?.value
            do {
                try await connection.send(text)
            } catch {
                onFailure()
            }
        }
    }

    private func withoutOwnReactions(_ counts: [String: Int]) -> [String: Int] {
        var remaining = counts
        func subtract(_ own: [String: Int]) -> [String: Int] {
            own.reduce(into: [String: Int]()) { left, entry in
                let taken = min(entry.value, remaining[entry.key] ?? 0)
                remaining[entry.key] = (remaining[entry.key] ?? 0) - taken
                if entry.value > taken { left[entry.key] = entry.value - taken }
            }
        }
        _ = subtract(ownReactionsCarried)
        ownReactionsCarried = subtract(ownReactionsSinceLastWindow)
        ownReactionsSinceLastWindow = [:]
        return remaining.filter { $0.value > 0 }
    }

    private func resolve(_ ref: String, with result: Result<Void, LiveCommandError>) {
        let command = sentCommands.removeValue(forKey: ref)
        // Appliqué à la réception de l'ack, dans l'ordre des messages du serveur.
        if case .success = result, let command { applyAcknowledged(command) }
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
                let delay = Self.backoff(afterFailures: failures)
                LiveLog.session.info("Reconnexion : tentative \(self.failures, privacy: .public) dans \(delay.components.seconds, privacy: .public) s")
                try? await environment.clock.sleep(for: delay)
                if status.isFinal || Task.isCancelled { return }
            }
            if let connection = await open() {
                await listen(on: connection)
            }
            if status.isFinal { return }
            failures += 1
            LiveLog.session.notice("Connexion perdue")
            dropConnection()
        }
    }

    static func backoff(afterFailures failures: Int) -> Duration {
        .seconds(min(10, 1 << min(failures - 1, 4)))
    }

    private func open() async -> (any WebSocketConnection)? {
        guard let token = try? await tokenProvider(), !status.isFinal else {
            if !status.isFinal { LiveLog.session.error("Connexion impossible : jeton de Participant indisponible") }
            return nil
        }
        guard let join = try? Self.encode(.join(token: token)) else { return nil }
        guard let connection = try? await environment.webSocket.connect(to: url) else {
            LiveLog.session.error("Connexion impossible : serveur injoignable")
            return nil
        }
        guard !status.isFinal else {
            connection.close()
            return nil
        }
        do { try await connection.send(join) } catch {
            LiveLog.session.error("Connexion impossible : envoi du join refusé")
            return nil
        }
        self.connection = connection
        return connection
    }

    private func listen(on connection: any WebSocketConnection) async {
        while !status.isFinal, let text = try? await connection.receive() {
            guard let message = try? WireCoding.decode(ServerMessage.self, from: Data(text.utf8)) else {
                LiveLog.session.notice("Message serveur illisible ignoré")
                continue
            }
            await handle(message)
        }
    }

    private func dropConnection() {
        connection?.close()
        connection = nil
        status = .reconnecting
        ownReactionsSinceLastWindow = [:]
        ownReactionsCarried = [:]
        failPendingCommands()
    }

    private func failPendingCommands() {
        let waiting = pending.values
        pending = [:]
        sentCommands = [:]
        waiting.forEach { $0.resume(returning: .failure(LiveCommandError(code: .disconnected, message: ""))) }
    }

    private func handle(_ message: ServerMessage) async {
        switch message {
        case .snapshot(let snapshot):
            apply(snapshot)
            failures = 0
            retriedInvalidToken = false
            status = .connected
            LiveLog.session.info("Live rejoint : rôle \(snapshot.role.rawValue, privacy: .public)")
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
            LiveLog.session.notice("Connexion remplacée : ce Live est ouvert sur un autre appareil")
            await finish(.replaced)
        case .banned:
            await finish(.banned)
        case .audience(let update):
            audience = update
        case .chatMessage(let message):
            // Le serveur peut renvoyer un message déjà reçu (rattrapage) : un seul exemplaire par `id`.
            guard !messages.contains(where: { $0.id == message.id }) else { break }
            if case .purchase = message.content { emit(.purchase(message)) }
            messages.append(message)
        case .messageDeleted(let messageId):
            messages.removeAll { $0.id == messageId }
        case .productPinned(let product):
            pinnedProduct = product
        case .productUnpinned:
            pinnedProduct = nil
        case .reactions(let update):
            reactionsTotal = update.total
            let others = withoutOwnReactions(update.counts)
            if !others.isEmpty { emit(.reactions(others)) }
        case .hostDisconnected:
            hostConnected = false
        case .hostReconnected:
            hostConnected = true
        case .roleChanged(let change):
            apply(change)
            await syncPublication()
        case .joinRequested(let participant):
            joinRequests = joinRequests.filter { $0.id != participant.id } + [participant]
        case .joinRequestCancelled(let participantId):
            joinRequests.removeAll { $0.id == participantId }
        case .joinDeclined:
            joinRequestPending = false
            emit(.joinDeclined)
        case .moderationChanged(let lists):
            moderation = withoutYou(lists)
        case .unknown(let type):
            LiveLog.session.info("Message serveur ignoré : type \(type, privacy: .public)")
        }
    }

    private func refuseJoin(_ code: LiveErrorCode) async {
        guard status != .connected else { return }
        LiveLog.session.error("Join refusé : \(code.rawValue, privacy: .public)")
        switch code {
        case .banned:
            await finish(.banned)
        case .liveNotFound:
            await finish(.failed(code))
        case .invalidToken where !retriedInvalidToken:
            // Jeton périmé entre sa signature et le join : une seule nouvelle chance, avec un jeton frais.
            retriedInvalidToken = true
            connection?.close()
        case .invalidToken:
            await finish(.failed(code))
        default:
            connection?.close()
        }
    }

    private func connectMedia(_ livekit: Snapshot.LiveKit) async {
        if !mediaConnected {
            do {
                try await media.connect(url: livekit.url, token: livekit.token)
                mediaConnected = true
                LiveLog.media.info("Room média connectée")
            } catch {
                LiveLog.media.error("Connexion à la room média impossible")
                return
            }
        }
        await syncPublication()
        if status.isFinal {
            await media.disconnect()
        }
    }

    /// Les Animateurs publient caméra et micro dans la room déjà connectée : pas de nouveau jeton.
    private func syncPublication() async {
        guard mediaConnected, !status.isFinal else { return }
        let onStage = role == .host || role == .cohost
        if onStage && !mediaPublished {
            do {
                try await media.publishCameraAndMicrophone()
                mediaPublished = true
            } catch {
                LiveLog.media.error("Publication de la caméra et du micro impossible")
            }
        } else if !onStage && mediaPublished {
            // Le serveur coupe aussi la permission : un échec ici laisse seulement les pistes locales.
            do { try await media.unpublishCameraAndMicrophone() } catch {
                LiveLog.media.error("Arrêt de la publication impossible")
            }
            mediaPublished = false
        }
    }

    private func finish(_ final: LiveStatus) async {
        status = final
        failPendingCommands()
        chatUnlockTask?.cancel()
        eventContinuations.values.forEach { $0.finish() }
        eventContinuations = [:]
        connection?.close()
        connection = nil
        await media.disconnect()
    }

    private func apply(_ change: RoleChanged) {
        let others = cohosts.filter { $0.id != change.participant.id }
        cohosts = change.role == .cohost ? others + [change.participant] : others
        joinRequests.removeAll { $0.id == change.participant.id }
        if change.participant.id == you?.id {
            role = change.role
            joinRequestPending = false
            // Les listes de modération sont réservées aux Animateurs, comme dans le `snapshot`.
            if change.role == .viewer { moderation = nil }
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
        // Les Demandes de montée en attente ne survivent pas à la fermeture du socket.
        joinRequestPending = false
        moderation = withoutYou(snapshot.moderation)
    }

    /// Un Animateur mis en Shadowban ne doit pas l'apprendre : il n'apparaît jamais dans ses propres listes.
    private func withoutYou(_ lists: Moderation?) -> Moderation? {
        guard let lists, let you else { return lists }
        return Moderation(
            shadowbanned: lists.shadowbanned.filter { $0.id != you.id },
            banned: lists.banned.filter { $0.id != you.id }
        )
    }
}

extension Duration {
    var timeInterval: TimeInterval {
        Double(components.seconds) + Double(components.attoseconds) / 1e18
    }
}
