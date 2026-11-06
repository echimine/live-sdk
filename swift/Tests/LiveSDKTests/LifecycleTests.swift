import Foundation
import Testing
import LiveSDK

@MainActor
@Suite("Cycle de vie : fins définitives du Live", .timeLimit(.minutes(1)))
struct LifecycleTests {
    @Test func laFinDuLiveDonneLeRecapitulatifSansReconnexion() async throws {
        let harness = Harness()
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json", harness: harness)

        try connection.push(fixture: "ws/server/liveEnded.host.json")
        connection.drop()

        #expect(await eventually { session.status == .ended(.endedByHost, LiveRecap(purchases: 14, reactions: 1284, peakAudience: 52)) })
        try await Self.expectNoReconnection(harness)
    }

    @Test func terminerAttendLaFinDuServeurPuisExposeLeRecapitulatif() async throws {
        let harness = Harness()
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json", harness: harness)
        let result = Task { try await session.send(.endLive) }
        let command = try await CommandTests.lastCommand(on: connection)
        #expect(command["type"] == .string("endLive"))
        connection.push(#"{"type":"ack","ref":\#(CommandTests.quoted(command["ref"]))}"#)
        try await result.value
        #expect(session.status == .connected)

        try connection.push(fixture: "ws/server/liveEnded.host.json")
        #expect(await eventually { session.status == .ended(.endedByHost, LiveRecap(purchases: 14, reactions: 1284, peakAudience: 52)) })
        try await Self.expectNoReconnection(harness)
    }

    @Test func laFinChezLeSpectateurFermeLesConnexionsSansRecapitulatif() async throws {
        let harness = Harness()
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)

        connection.push(#"{"type":"liveEnded","reason":"hostTimeout"}"#)

        #expect(await eventually { session.status == .ended(.hostTimeout, nil) })
        #expect(connection.closed)
        try await Self.expectNoReconnection(harness)
    }

    @Test func uneConnexionRemplaceeNeSeReconnectePas() async throws {
        let harness = Harness()
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)

        try connection.push(fixture: "ws/server/replaced.json")
        connection.drop()

        #expect(await eventually { session.status == .replaced })
        try await Self.expectNoReconnection(harness)
    }

    @Test func unParticipantBanniQuitteLeLive() async throws {
        let harness = Harness()
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)

        try connection.push(fixture: "ws/server/banned.json")
        connection.drop()

        #expect(await eventually { session.status == .banned })
        try await Self.expectNoReconnection(harness)
    }

    @Test func unBanniRefuseAuJoinNeRetentePas() async throws {
        let harness = Harness()
        let session = try await harness.configuredSDK().openLive(id: "lv_8f3k2m")
        let connection = try await harness.connection(0)

        try connection.push(fixture: "ws/server/error.banned.json")
        connection.drop()

        #expect(await eventually { session.status == .banned })
        try await Self.expectNoReconnection(harness)
    }

    @Test func unLiveIntrouvableEchoueSansRetenter() async throws {
        let harness = Harness()
        let session = try await harness.configuredSDK().openLive(id: "lv_inconnu")
        let connection = try await harness.connection(0)

        connection.push(#"{"type":"error","code":"live_not_found","message":"Live introuvable."}"#)
        connection.drop()

        #expect(await eventually { session.status == .failed(.liveNotFound) })
        try await Self.expectNoReconnection(harness)
    }

    @Test func unJetonRefuseAuJoinEstRetenteUneFoisAvecUnJetonFrais() async throws {
        let harness = Harness()
        let session = try await harness.configuredSDK().openLive(id: "lv_8f3k2m")
        let first = try await harness.connection(0)
        _ = await eventually { first.sent.count == 1 }

        first.push(#"{"type":"error","code":"invalid_token","message":"Jeton de Participant refusé."}"#)
        first.drop()

        let second = try await harness.connection(1)
        #expect(await eventually { second.sent.count == 1 })
        #expect(second.sentJSON.first == .object(["type": .string("join"), "token": .string("jeton-\(harness.tokens.count)")]))
        #expect(second.sentJSON.first != first.sentJSON.first)
        #expect(session.status != .failed(.invalidToken))

        try second.push(fixture: "ws/server/snapshot.viewer.json")
        #expect(await eventually { session.status == .connected })
    }

    @Test func unJetonRefuseDeuxFoisAuJoinFaitEchouerLeLive() async throws {
        let harness = Harness()
        let session = try await harness.configuredSDK().openLive(id: "lv_8f3k2m")
        let first = try await harness.connection(0)

        first.push(#"{"type":"error","code":"invalid_token","message":"Jeton de Participant refusé."}"#)
        first.drop()
        let second = try await harness.connection(1)
        second.push(#"{"type":"error","code":"invalid_token","message":"Jeton de Participant refusé."}"#)
        second.drop()

        #expect(await eventually { session.status == .failed(.invalidToken) })
        try await Task.sleep(for: .milliseconds(50))
        #expect(harness.socket.connectAttempts.count == 2)
        // Un jeton pour la config, un par join : pas de troisième tentative.
        #expect(harness.tokens.count == 3)
    }

    @Test func uneErreurSansReferenceEnCoursDeLiveNeLeTerminePas() async throws {
        let harness = Harness()
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)

        connection.push(#"{"type":"error","code":"invalid_command","message":"Message illisible."}"#)
        try connection.push(fixture: "ws/server/hostDisconnected.json")

        #expect(await eventually { !session.hostConnected })
        #expect(session.status == .connected)
    }

    @Test func quitterLeLiveFermeLeSocketEtLeMedia() async throws {
        let harness = Harness()
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)

        await session.leave()

        #expect(connection.closed)
        #expect(session.status == .left)
        try await Self.expectNoReconnection(harness)
    }

    @Test func quitterPendantLaReconnexionArreteLesTentatives() async throws {
        let harness = Harness()
        let (session, first) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)
        harness.socket.failNextConnections(1_000_000)
        first.drop()
        _ = await eventually { harness.socket.connectAttempts.count > 3 }

        await session.leave()
        let attempts = harness.socket.connectAttempts.count
        try await Task.sleep(for: .milliseconds(50))

        #expect(harness.socket.connectAttempts.count == attempts)
        #expect(session.status == .left)
    }

    static func expectNoReconnection(_ harness: Harness) async throws {
        try await Task.sleep(for: .milliseconds(50))
        #expect(harness.socket.connectAttempts.count == 1)
        #expect(harness.media.events.last == "disconnect")
    }
}
