import Foundation
import Testing
import LiveSDK

@MainActor
@Suite("Reconnexion : backoff plafonné, jeton frais, rattrapage par snapshot", .timeLimit(.minutes(1)))
struct ReconnectionTests {
    @Test func uneCoupureReconnecteAvecUnJetonFraisPuisRattrapeLEtat() async throws {
        let harness = Harness()
        let (session, first) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)
        let firstJoin = first.sentJSON.first

        harness.socket.failNextConnections(4)
        first.drop()

        let second = try await harness.connection(1)
        #expect(await eventually { second.sent.count == 1 })
        #expect(second.sentJSON.first == .object(["type": .string("join"), "token": .string("jeton-\(harness.tokens.count)")]))
        #expect(second.sentJSON.first != firstJoin)
        #expect(harness.clock.sleeps == [.seconds(1), .seconds(2), .seconds(4), .seconds(8), .seconds(10)])

        try second.push(fixture: "ws/server/snapshot.minimal.json")
        #expect(await eventually { session.status == .connected && session.host?.name == "Marc" })
        #expect(session.messages.isEmpty)
        #expect(harness.media.events.count == 1)
    }

    @Test func leDelaiEntreDeuxTentativesPlafonneA10Secondes() async throws {
        let harness = Harness()
        let (_, first) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)

        harness.socket.failNextConnections(7)
        first.drop()

        _ = try await harness.connection(1)
        #expect(harness.clock.sleeps.suffix(4) == [.seconds(10), .seconds(10), .seconds(10), .seconds(10)])
        #expect(harness.clock.sleeps.count == 8)
    }

    @Test func leBackoffRepartDeZeroApresUnRattrapageReussi() async throws {
        let harness = Harness()
        let (session, first) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)
        harness.socket.failNextConnections(2)
        first.drop()
        let second = try await harness.connection(1)
        try second.push(fixture: "ws/server/snapshot.viewer.json")
        _ = await eventually { session.status == .connected }

        second.drop()
        _ = try await harness.connection(2)

        #expect(harness.clock.sleeps == [.seconds(1), .seconds(2), .seconds(4), .seconds(1)])
    }

    @Test func pendantLaCoupureLeStatutLeDitEtLesCommandesEnCoursEchouent() async throws {
        let harness = Harness()
        let (session, first) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)
        let command = Task { try await session.send(.requestToJoin) }
        _ = await eventually { first.sent.count == 2 }

        first.drop()

        await #expect(throws: LiveCommandError(code: .disconnected, message: "")) {
            try await command.value
        }
        #expect(await eventually { session.status == .reconnecting })
    }

    @Test func avantLeRattrapageUneCommandeEchoueSansPartir() async throws {
        let harness = Harness()
        let (session, first) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)
        first.drop()
        let second = try await harness.connection(1)
        _ = await eventually { second.sent.count == 1 }

        await #expect(throws: LiveCommandError(code: .disconnected, message: "")) {
            try await session.send(.requestToJoin)
        }
        #expect(second.sent.count == 1)
    }

    @Test func unJoinFreinéParLeServeurEstRetenteApresLeDelai() async throws {
        let harness = Harness()
        let session = try await harness.configuredSDK().openLive(id: "lv_8f3k2m")
        let first = try await harness.connection(0)

        first.push(#"{"type":"error","code":"rate_limited","message":"Doucement…","retryAfterMs":3000}"#)
        first.drop()

        let second = try await harness.connection(1)
        try second.push(fixture: "ws/server/snapshot.viewer.json")
        #expect(await eventually { session.status == .connected })
    }
}
