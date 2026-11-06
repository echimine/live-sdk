import Foundation
import Testing
import LiveSDK

@MainActor
@Suite("Modération : actions des Animateurs, Shadowban et Bannissement", .timeLimit(.minutes(1)))
struct ModerationTests {
    @Test func lHotePeutSupprimerUnMessageEtModererSonAuteur() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json")
        try connection.push(fixture: "ws/server/chatMessage.json")
        let message = try await Self.message("msg_0193", in: session)

        #expect(session.moderationActions(for: message) == [.deleteMessage, .shadowban, .ban])
    }

    @Test func lAuteurDejaEnShadowbanPeutEtreLeveOuBanni() async throws {
        let (session, _) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json")
        let message = try await Self.message("msg_0194", in: session)

        #expect(session.moderationActions(for: message) == [.deleteMessage, .unshadowban, .ban])
    }

    @Test func unCoHoteNePeutQueSupprimerLeMessageDUnAutreCoHote() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.cohost.json")
        connection.push(CohostTests.roleChanged(id: "twitch:u_88", name: "Noa", role: "cohost"))
        _ = await eventually { session.cohosts.contains { $0.id == "twitch:u_88" } }
        // Envoyé quand Noa était encore Spectateur : c'est son rôle actuel qui compte.
        let message = try await Self.message("msg_0193", in: session)

        #expect(session.moderationActions(for: message) == [.deleteMessage])
    }

    @Test func lHotePeutModererUnCoHote() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json")
        connection.push(CohostTests.roleChanged(id: "twitch:u_88", name: "Noa", role: "cohost"))
        _ = await eventually { session.cohosts.contains { $0.id == "twitch:u_88" } }
        let message = try await Self.message("msg_0193", in: session)

        #expect(session.moderationActions(for: message) == [.deleteMessage, .shadowban, .ban])
    }

    @Test func personneNeModereLHoteNiSoiMeme() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.cohost.json")
        connection.push(Self.chatMessage(id: "m_hote", authorId: "tiktok:u_1042", name: "Léa", role: "host"))
        connection.push(Self.chatMessage(id: "m_moi", authorId: "snapcore:u_310", name: "Sam", role: "cohost"))

        #expect(session.moderationActions(for: try await Self.message("m_hote", in: session)) == [.deleteMessage])
        #expect(session.moderationActions(for: try await Self.message("m_moi", in: session)) == [.deleteMessage])
    }

    @Test func lesMessagesPassesDUnBanniNePeuventQuEtreSupprimes() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json")
        connection.push(Self.chatMessage(id: "m_troll", authorId: "strava:u_13", name: "Troll", role: "viewer"))

        #expect(session.moderationActions(for: try await Self.message("m_troll", in: session)) == [.deleteMessage])
    }

    @Test func rienNeMeReveleMonPropreShadowban() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.cohost.json")

        connection.push(#"{"type":"moderationChanged","shadowbanned":[{"id":"instagram:u_5521","app":"instagram","name":"Inès"},{"id":"snapcore:u_310","app":"snapcore","name":"Sam"}],"banned":[]}"#)

        #expect(await eventually { session.moderation?.banned.isEmpty == true })
        #expect(session.moderation?.shadowbanned.map(\.id) == ["instagram:u_5521"])
    }

    @Test func redescenduSpectateurJeNeVoisPlusLesListes() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.cohost.json")
        #expect(session.moderation != nil)

        connection.push(CohostTests.roleChanged(id: "snapcore:u_310", name: "Sam", role: "viewer"))

        #expect(await eventually { session.role == .viewer })
        #expect(session.moderation == nil)
    }

    @Test func unBanniPeutRejoindreUnAutreLive() async throws {
        let harness = Harness()
        let (banni, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)
        try connection.push(fixture: "ws/server/banned.json")
        connection.drop()
        #expect(await eventually { banni.status == .banned })

        let autre = try await harness.configuredSDK().openLive(id: "lv_2b9q7x")
        try (try await harness.connection(1)).push(fixture: "ws/server/snapshot.minimal.json")

        #expect(await eventually { autre.status == .connected })
        #expect(banni.status == .banned)
    }

    @Test func unSpectateurNePeutRienModerer() async throws {
        let (session, _) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json")
        let message = try await Self.message("msg_0194", in: session)

        #expect(session.moderationActions(for: message).isEmpty)
    }

    static func chatMessage(id: String, authorId: String, name: String, role: String) -> String {
        let app = authorId.split(separator: ":").first.map(String.init) ?? ""
        return #"{"type":"chatMessage","message":{"id":"\#(id)","kind":"text","author":{"id":"\#(authorId)","app":"\#(app)","name":"\#(name)"},"role":"\#(role)","text":"Salut","at":"2026-11-06T18:06:00.000Z"}}"#
    }

    static func message(_ id: String, in session: LiveSession) async throws -> ChatMessage {
        _ = await eventually { session.messages.contains { $0.id == id } }
        return try #require(session.messages.first { $0.id == id })
    }
}
