import Foundation
import Testing
import LiveSDK

@MainActor
final class EventLog {
    private(set) var events: [LiveEvent] = []
    private(set) var finished = false
    private var task: Task<Void, Never>?

    init(_ session: LiveSession) {
        let stream = session.events()
        task = Task { [weak self] in
            for await event in stream { self?.events.append(event) }
            self?.finished = true
        }
    }
}

@MainActor
@Suite("Réactions : jeu de la config, animation immédiate, sans double compte", .timeLimit(.minutes(1)))
struct ReactionsTests {
    @Test func maReactionPartSansAccuseEtSAnimeAussitot() async throws {
        let (session, connection) = try await ChatTests.joined()
        let log = EventLog(session)

        session.react("🔥")

        #expect(await eventually { connection.sent.count == 2 })
        #expect(connection.sentJSON.last == .object(["type": .string("react"), "emoji": .string("🔥")]))
        #expect(await eventually { log.events == [.reactions(["🔥": 1])] })
    }

    @Test func unEmojiHorsDuJeuDeLaConfigEstIgnore() async throws {
        let (session, connection) = try await ChatTests.joined()
        let log = EventLog(session)

        session.react("🍕")

        try await Task.sleep(for: .milliseconds(30))
        #expect(connection.sent.count == 1)
        #expect(log.events.isEmpty)
    }

    @Test func lesReactionsDeTousSontAnimeesSansRejouerLaMienne() async throws {
        let (session, connection) = try await ChatTests.joined()
        let log = EventLog(session)

        session.react("🔥")
        connection.push(#"{"type":"reactions","counts":{"🔥":3,"😂":2},"total":1400}"#)

        #expect(await eventually { log.events.count == 2 })
        #expect(log.events.last == .reactions(["🔥": 2, "😂": 2]))
        #expect(session.reactionsTotal == 1400)
    }

    @Test func maReactionArriveeDansLaFenetreSuivanteNEstRetireeQuUneFois() async throws {
        let (session, connection) = try await ChatTests.joined()
        let log = EventLog(session)

        session.react("🔥")
        connection.push(#"{"type":"reactions","counts":{"😂":1},"total":1}"#)
        connection.push(#"{"type":"reactions","counts":{"🔥":1},"total":2}"#)
        connection.push(#"{"type":"reactions","counts":{"🔥":1},"total":3}"#)

        #expect(await eventually { session.reactionsTotal == 3 })
        #expect(log.events == [.reactions(["🔥": 1]), .reactions(["😂": 1]), .reactions(["🔥": 1])])
    }

    @Test func horsConnexionUneReactionEstIgnoree() async throws {
        let harness = Harness()
        let session = try await harness.configuredSDK().openLive(id: "lv_8f3k2m")
        let connection = try await harness.connection(0)
        _ = await eventually { connection.sent.count == 1 }

        session.react("❤️")

        try await Task.sleep(for: .milliseconds(30))
        #expect(connection.sent.count == 1)
    }

    @Test func uneReactionQuiNAPasPuPartirNeMasquePasCelleDesAutres() async throws {
        let (session, connection) = try await ChatTests.joined()
        let log = EventLog(session)
        connection.failSends()

        session.react("🔥")
        _ = await eventually { log.events.count == 1 }
        try await Task.sleep(for: .milliseconds(20))
        connection.push(#"{"type":"reactions","counts":{"🔥":1},"total":1}"#)

        #expect(await eventually { log.events.count == 2 })
        #expect(log.events.last == .reactions(["🔥": 1]))
    }

    @Test func leFluxDEvenementsSeTermineAvecLeLive() async throws {
        let (session, connection) = try await ChatTests.joined()
        let log = EventLog(session)

        try connection.push(fixture: "ws/server/liveEnded.json")

        #expect(await eventually { log.finished })
    }
}
