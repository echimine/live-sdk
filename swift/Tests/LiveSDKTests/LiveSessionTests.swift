import Foundation
import Testing
import LiveSDK

@MainActor
@Suite("Live : join, snapshot et état observable", .timeLimit(.minutes(1)))
struct LiveSessionTests {
    @Test func ouvrirUnLiveRejointAvecUnJetonFraisPuisExposeLeSnapshot() async throws {
        let harness = Harness()
        let sdk = await harness.configuredSDK()

        let session = try await sdk.openLive(id: "lv_8f3k2m")
        let connection = try await harness.connection(0)
        #expect(connection.url.absoluteString == "wss://live.test/v1/lives/lv_8f3k2m/ws")
        #expect(await eventually { connection.sent.count == 1 })
        #expect(connection.sentJSON.first == .object(["type": .string("join"), "token": .string("jeton-\(harness.tokens.count)")]))

        try connection.push(fixture: "ws/server/snapshot.viewer.json")

        #expect(await eventually { session.status == .connected })
        #expect(session.title == "Unboxing des nouvelles baskets")
        #expect(session.role == .viewer)
        #expect(session.you?.name == "Noa")
        #expect(session.host?.name == "Léa")
        #expect(session.hostConnected)
        #expect(session.cohosts.map(\.id) == ["snapcore:u_310"])
        #expect(session.pinnedProduct?.price == 8999)
        #expect(session.audience.total == 37)
        #expect(session.audience.byApp["twitch"] == 9)
        #expect(session.reactionsTotal == 1284)
        #expect(session.messages.map(\.id) == ["msg_0193", "msg_0194"])
        #expect(harness.media.events == ["connect wss://livekit.echimine.fr eyJhbGciOiJIUzI1NiJ9.bGl2ZWtpdC1leGVtcGxl.c2lnbmF0dXJl"])
    }

    @Test func lesTypesEtChampsInconnusSontIgnores() async throws {
        let harness = Harness()
        let session = try await harness.configuredSDK().openLive(id: "lv_2b9q7x")
        let connection = try await harness.connection(0)

        connection.push(#"{"type":"evenementDuFutur","valeur":42}"#)
        connection.push(#"pas du JSON"#)
        connection.push(try Fixtures.text("ws/server/snapshot.minimal.json").replacingOccurrences(of: #""reactionsTotal""#, with: #""champDuFutur":{"a":1},"reactionsTotal""#))
        connection.push(#"{"type":"audience","total":2,"byApp":{"twitch":2},"nouveau":true}"#)

        #expect(await eventually { session.audience.total == 2 })
        #expect(session.status == .connected)
        #expect(session.host?.name == "Marc")
    }

    @Test func unMessageArriveDansLeChatPuisEnEstSupprime() async throws {
        let (session, connection) = try await Self.joined(fixture: "ws/server/snapshot.minimal.json")

        try connection.push(fixture: "ws/server/chatMessage.json")
        try connection.push(fixture: "ws/server/chatMessage.purchase.json")
        #expect(await eventually { session.messages.count == 2 })
        #expect(session.messages.first?.content == .text("Elles existent en 42 ?"))

        try connection.push(fixture: "ws/server/messageDeleted.json")
        #expect(await eventually { session.messages.map(\.id) == ["msg_0194"] })
    }

    @Test func leProduitEpingleChangePuisEstRetire() async throws {
        let (session, connection) = try await Self.joined(fixture: "ws/server/snapshot.minimal.json")

        try connection.push(fixture: "ws/server/productPinned.json")
        #expect(await eventually { session.pinnedProduct != nil })

        try connection.push(fixture: "ws/server/productUnpinned.json")
        #expect(await eventually { session.pinnedProduct == nil })
    }

    @Test func leTotalDesReactionsSuitLeServeur() async throws {
        let (session, connection) = try await Self.joined(fixture: "ws/server/snapshot.viewer.json")

        try connection.push(fixture: "ws/server/reactions.json")

        #expect(await eventually { session.reactionsTotal == 1311 })
    }

    @Test func lAudienceRemplaceLeTotalEtLaRepartitionParApp() async throws {
        let (session, connection) = try await Self.joined(fixture: "ws/server/snapshot.viewer.json")

        try connection.push(fixture: "ws/server/audience.json")
        #expect(await eventually { session.audience.total == 38 })
        #expect(session.audience.byApp["twitch"] == 10)

        connection.push(#"{"type":"audience","total":0,"byApp":{}}"#)
        #expect(await eventually { session.audience == .empty })
        await session.leave()
    }

    @Test func lAbsencePuisLeRetourDeLHoteSontVisibles() async throws {
        let (session, connection) = try await Self.joined(fixture: "ws/server/snapshot.viewer.json")

        try connection.push(fixture: "ws/server/hostDisconnected.json")
        #expect(await eventually { !session.hostConnected })

        try connection.push(fixture: "ws/server/hostReconnected.json")
        #expect(await eventually { session.hostConnected })
    }

    @Test func unSpectateurQuiMonteDevientCoHotePuisRedescend() async throws {
        let (session, connection) = try await Self.joined(fixture: "ws/server/snapshot.minimal.json")

        try connection.push(fixture: "ws/server/roleChanged.json")
        #expect(await eventually { session.cohosts.map(\.id) == ["snapcore:u_310"] })

        connection.push(#"{"type":"roleChanged","participant":{"id":"snapcore:u_310","app":"snapcore","name":"Sam"},"role":"viewer"}"#)
        #expect(await eventually { session.cohosts.isEmpty })
    }

    @Test func monPropreRoleSuitLesChangementsDuServeur() async throws {
        let (session, connection) = try await Self.joined(fixture: "ws/server/snapshot.minimal.json")

        connection.push(#"{"type":"roleChanged","participant":{"id":"twitch:u_88","app":"twitch","name":"Noa"},"role":"cohost"}"#)

        #expect(await eventually { session.role == .cohost })
        #expect(session.cohosts.map(\.id) == ["twitch:u_88"])
    }

    @Test func lHoteVoitArriverPuisPartirLesDemandesDeMontee() async throws {
        let (session, connection) = try await Self.joined(fixture: "ws/server/snapshot.minimal.json")

        try connection.push(fixture: "ws/server/joinRequested.json")
        #expect(await eventually { session.joinRequests.map(\.id) == ["twitch:u_88"] })

        try connection.push(fixture: "ws/server/joinRequestCancelled.json")
        #expect(await eventually { session.joinRequests.isEmpty })
    }

    @Test func lesAnimateursVoientLesListesDeModerationAJour() async throws {
        let (session, connection) = try await Self.joined(fixture: "ws/server/snapshot.minimal.json")

        try connection.push(fixture: "ws/server/moderationChanged.json")

        #expect(await eventually { session.moderation?.shadowbanned.map(\.id) == ["instagram:u_5521"] })
        #expect(session.moderation?.banned.map(\.id) == ["strava:u_13"])
    }

    @Test func desValeursInconnuesNEmpechentPasDeRejoindre() async throws {
        let harness = Harness()
        let session = try await harness.configuredSDK().openLive(id: "lv_2b9q7x")
        let connection = try await harness.connection(0)
        let futur = #"[{"id":"m1","kind":"system","at":"2026-11-06T18:05:02.120Z","author":{"id":"a:1","app":"a","name":"A"},"role":"viewer"},{"id":"m2","kind":"text","text":"Salut","at":"2026-11-06T18:05:03.120Z","author":{"id":"a:2","app":"a","name":"B"},"role":"moderator"}]"#

        connection.push(try Fixtures.text("ws/server/snapshot.minimal.json").replacingOccurrences(of: #""messages": []"#, with: #""messages": \#(futur)"#))

        #expect(await eventually { session.status == .connected })
        #expect(session.messages.map(\.id) == ["m2"])
        #expect(session.messages.first?.role == .unknown)
    }

    @Test func uneFinDeLiveAuMotifInconnuTermineQuandMemeLeLive() async throws {
        let (session, connection) = try await Self.joined(fixture: "ws/server/snapshot.viewer.json")

        connection.push(#"{"type":"liveEnded","reason":"moderated"}"#)

        #expect(await eventually { session.status == .ended(.unknown, nil) })
    }

    static func joined(fixture: String, harness: Harness = Harness()) async throws -> (LiveSession, FakeConnection) {
        let session = try await harness.configuredSDK().openLive(id: "lv_8f3k2m")
        let connection = try await harness.connection(0)
        try connection.push(fixture: fixture)
        _ = await eventually { session.status == .connected }
        return (session, connection)
    }
}
