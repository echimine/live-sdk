import Foundation
import Testing
import LiveSDK

@MainActor
@Suite("Média : une room LiveKit par Live, jamais après la sortie", .timeLimit(.minutes(1)))
struct MediaTests {
    @Test func quitterPendantLaConnexionMediaNeRessusciteNiLeLiveNiLaRoom() async throws {
        let harness = Harness()
        let media = FakeMedia()
        media.holdConnects()
        harness.medias.prepare(media)
        let session = try await harness.configuredSDK().openLive(id: "lv_8f3k2m")
        let connection = try await harness.connection(0)
        try connection.push(fixture: "ws/server/snapshot.viewer.json")
        _ = await eventually { media.isHeld }

        await session.leave()
        media.releaseConnect()

        try await Task.sleep(for: .milliseconds(50))
        #expect(session.status == .left)
        #expect(media.events.last == "disconnect")
        #expect(harness.socket.connectAttempts.count == 1)
    }

    @Test func chaqueLiveOuvertASaPropreRoom() async throws {
        let harness = Harness()
        let sdk = await harness.configuredSDK()
        let premier = try await sdk.openLive(id: "lv_8f3k2m")
        try (try await harness.connection(0)).push(fixture: "ws/server/snapshot.viewer.json")
        let second = try await sdk.openLive(id: "lv_2b9q7x")
        try (try await harness.connection(1)).push(fixture: "ws/server/snapshot.minimal.json")
        _ = await eventually { premier.status == .connected && second.status == .connected }

        await premier.leave()

        #expect(harness.medias.all.count == 2)
        #expect(harness.medias.all.first?.events.last == "disconnect")
        #expect(harness.medias.all.last?.events.contains("disconnect") == false)
    }

    @Test func uneConnexionMediaRateeEstRetenteeAuRattrapageSuivant() async throws {
        let harness = Harness()
        let media = FakeMedia()
        media.failNextConnects(1)
        harness.medias.prepare(media)
        let (_, first) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)

        first.drop()
        try (try await harness.connection(1)).push(fixture: "ws/server/snapshot.minimal.json")

        #expect(await eventually { media.events.filter { $0.hasPrefix("connect") }.count == 2 })
    }

    @Test func lHotePublieCameraEtMicroDesQueLaRoomEstConnectee() async throws {
        let harness = Harness()
        _ = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json", harness: harness)

        #expect(await eventually { harness.media.events.last == "publish" })
        #expect(harness.media.events.first?.hasPrefix("connect") == true)
    }

    @Test func unSpectateurNePubliePas() async throws {
        let harness = Harness()
        let (_, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)
        _ = await eventually { harness.media.events.first?.hasPrefix("connect") == true }

        try connection.push(fixture: "ws/server/hostDisconnected.json")
        try connection.push(fixture: "ws/server/hostReconnected.json")
        try connection.push(fixture: "ws/server/snapshot.viewer.json")
        _ = await eventually(timeout: .milliseconds(200)) { false }
        #expect(harness.media.events.contains("publish") == false)
    }

    @Test func unePublicationRateeEstRetenteeAuRattrapageSuivant() async throws {
        let harness = Harness()
        let media = FakeMedia()
        media.failNextPublishes(1)
        harness.medias.prepare(media)
        let (_, first) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json", harness: harness)
        _ = await eventually { media.events.contains("publish") }

        first.drop()
        try (try await harness.connection(1)).push(fixture: "ws/server/snapshot.host.json")

        #expect(await eventually { media.events.filter { $0 == "publish" }.count == 2 })
        #expect(media.events.filter { $0.hasPrefix("connect") }.count == 1)
    }
}
