import Foundation
import Testing
import LiveSDK

@MainActor
@Suite("Découverte : liste et lancement des Lives", .timeLimit(.minutes(1)))
struct DiscoveryTests {
    @Test func laListeDesLivesEstDemandeeAvecUnJetonFrais() async throws {
        let harness = Harness()
        try harness.http.reply("GET", "/v1/lives", fixture: "http/lives.list.response.json")
        let sdk = await harness.configuredSDK()

        let lives = try await sdk.lives()

        #expect(lives.map(\.id) == ["lv_8f3k2m", "lv_2b9q7x"])
        #expect(lives.first?.host.name == "Léa")
        let request = try #require(harness.http.requests(to: "/v1/lives").last)
        #expect(request.headers["Authorization"] == "Bearer jeton-\(harness.tokens.count)")
    }

    @Test func lancerUnLiveEnvoieLeTitreEtRendLeLive() async throws {
        let harness = Harness()
        try harness.http.reply("POST", "/v1/lives", fixture: "http/lives.create.response.json")
        let sdk = await harness.configuredSDK()

        let live = try await sdk.startLive(title: "Unboxing des nouvelles baskets")

        #expect(live.id == "lv_8f3k2m")
        let request = try #require(harness.http.requests(to: "/v1/lives").last)
        #expect(try JSONValue.parse(request.body ?? Data()) == JSONValue.parse(Fixtures.data("http/lives.create.request.json")))
        #expect(request.headers["Content-Type"] == "application/json")
    }

    @Test func relancerRendLeLiveEnCoursSansRemplacerSonTitre() async throws {
        let harness = Harness()
        try harness.http.reply("POST", "/v1/lives", status: 201, fixture: "http/lives.create.response.json")
        try harness.http.reply("POST", "/v1/lives", status: 200, fixture: "http/lives.create.response.json")
        let sdk = await harness.configuredSDK()

        let first = try await sdk.startLive(title: "Unboxing des nouvelles baskets")
        let resumed = try await sdk.startLive(title: "Un autre titre")

        #expect(resumed == first)
        #expect(resumed.title == "Unboxing des nouvelles baskets")
        #expect(harness.http.requests(to: "/v1/lives").count == 2)
    }

    @Test func lancerUnLiveSansTitreEnvoieUnCorpsVide() async throws {
        let harness = Harness()
        try harness.http.reply("POST", "/v1/lives", fixture: "http/lives.create.response.json")
        let sdk = await harness.configuredSDK()

        _ = try await sdk.startLive()

        let request = try #require(harness.http.requests(to: "/v1/lives").last)
        #expect(try JSONValue.parse(request.body ?? Data()) == .object([:]))
    }

    @Test func uneErreurDuServeurRemonteAvecSonCode() async throws {
        let harness = Harness()
        try harness.http.reply("GET", "/v1/lives", status: 429, fixture: "http/error.json")
        let sdk = await harness.configuredSDK()

        await #expect(throws: LiveSDKError.server(code: "rate_limited", message: "Trop de requêtes, réessayez plus tard.")) {
            try await sdk.lives()
        }
    }

    @Test func sansConfigurationLeSDKRefuseDAppeler() async {
        let sdk = LiveSDK(environment: Harness().environment)

        await #expect(throws: LiveSDKError.notConfigured) {
            try await sdk.lives()
        }
    }
}
