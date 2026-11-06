import Foundation
import Testing
import LiveSDK

@MainActor
@Suite("Co-hôtes : Demande de montée, publication et scène", .timeLimit(.minutes(1)))
struct CohostTests {
    @Test func uneDemandeDeMonteeAcquitteeResteEnAttenteJusquAAnnulation() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json")
        #expect(session.joinRequestPending == false)

        try await acknowledged(.requestToJoin, by: session, on: connection, count: 2)
        #expect(session.joinRequestPending)

        try await acknowledged(.cancelJoinRequest, by: session, on: connection, count: 3)
        #expect(session.joinRequestPending == false)
    }

    @Test func monterALEcranClotMaDemande() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json")
        try await acknowledged(.requestToJoin, by: session, on: connection, count: 2)

        connection.push(Self.roleChanged(id: "twitch:u_88", name: "Noa", role: "cohost"))

        #expect(await eventually { session.role == .cohost })
        #expect(session.joinRequestPending == false)
    }

    @Test func unRefusDeLHoteClotMaDemandeEtLAnnonce() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json")
        try await acknowledged(.requestToJoin, by: session, on: connection, count: 2)
        let stream = session.events()
        let declined = Task { () -> Bool in
            for await event in stream where event == .joinDeclined { return true }
            return false
        }

        try connection.push(fixture: "ws/server/joinDeclined.json")

        #expect(await declined.value)
        #expect(session.joinRequestPending == false)
    }

    @Test func uneReconnexionPerdLaDemandeCommeLeServeur() async throws {
        let harness = Harness()
        let (session, first) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)
        try await acknowledged(.requestToJoin, by: session, on: first, count: 2)

        first.drop()
        try (try await harness.connection(1)).push(fixture: "ws/server/snapshot.viewer.json")

        #expect(await eventually { session.status == .connected && !session.joinRequestPending })
    }

    @Test func accepteJePublieCameraEtMicroSansMeReconnecter() async throws {
        let harness = Harness()
        let (_, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)
        _ = await eventually { harness.media.events.first?.hasPrefix("connect") == true }

        connection.push(Self.roleChanged(id: "twitch:u_88", name: "Noa", role: "cohost"))

        #expect(await eventually { harness.media.events.last == "publish" })
        #expect(harness.media.events.filter { $0.hasPrefix("connect") }.count == 1)
        #expect(harness.socket.connectAttempts.count == 1)
    }

    @Test func redescenduJeNePubliePlusEtResteDansLeLive() async throws {
        let harness = Harness()
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.cohost.json", harness: harness)
        #expect(await eventually { harness.media.events.last == "publish" })

        connection.push(Self.roleChanged(id: "snapcore:u_310", name: "Sam", role: "viewer"))

        #expect(await eventually { harness.media.events.last == "unpublish" })
        #expect(session.role == .viewer)
        #expect(session.status == .connected)
        #expect(harness.media.events.contains("disconnect") == false)
    }

    @Test func uneDemandeRefuseeQuitteLaListeDeLHote() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json")
        try connection.push(fixture: "ws/server/joinRequested.json")
        _ = await eventually { session.joinRequests.map(\.id).contains("twitch:u_88") }

        try await acknowledged(.declineJoin(participantId: "twitch:u_88"), by: session, on: connection, count: 2)

        #expect(session.joinRequests.map(\.id).contains("twitch:u_88") == false)
    }

    @Test func uneDemandeAccepteeDevientLeDernierCoHoteDeLaScene() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json")
        try connection.push(fixture: "ws/server/joinRequested.json")
        _ = await eventually { session.joinRequests.map(\.id).contains("twitch:u_88") }

        connection.push(Self.roleChanged(id: "twitch:u_88", name: "Noa", role: "cohost"))

        #expect(await eventually { session.cohosts.last?.id == "twitch:u_88" })
        #expect(session.joinRequests.map(\.id).contains("twitch:u_88") == false)
        #expect(session.stage.map(\.id) == ["tiktok:u_1042", "snapcore:u_310", "twitch:u_88"])
    }

    static func roleChanged(id: String, name: String, role: String) -> String {
        let app = id.split(separator: ":").first.map(String.init) ?? ""
        return #"{"type":"roleChanged","participant":{"id":"\#(id)","app":"\#(app)","name":"\#(name)"},"role":"\#(role)"}"#
    }

    func acknowledged(_ command: LiveCommand, by session: LiveSession, on connection: FakeConnection, count: Int) async throws {
        async let result: Void = session.send(command)
        let sent = try await CommandTests.lastCommand(on: connection, count: count)
        connection.push(#"{"type":"ack","ref":\#(CommandTests.quoted(sent["ref"]))}"#)
        try await result
    }
}
