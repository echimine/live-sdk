import Foundation
import Testing
import LiveSDK

@MainActor
@Suite("Config : chargement, cache de 5 min et valeurs par défaut", .timeLimit(.minutes(1)))
struct ConfigTests {
    static func fixtureConfig() throws -> LiveConfig {
        try JSONDecoder().decode(LiveConfig.self, from: Fixtures.data("config.json"))
    }

    @Test func avantToutChargementLaConfigEstCelleEmbarquee() throws {
        let sdk = LiveSDK(environment: Harness().environment)

        #expect(sdk.config == (try Self.fixtureConfig()))
    }

    @Test func configureChargeLaConfigServie() async throws {
        let harness = Harness()
        harness.http.reply("GET", "/v1/config", headers: ["ETag": "\"v2\""], body: Data("""
        {"reactions":["🔥","❤️","👏","🎉"],"chat":{"maxLength":120},"images":{"maxBytes":2048,"formats":["image/png"]},"product":{"nameMaxLength":40}}
        """.utf8))

        let sdk = await harness.configuredSDK()

        #expect(sdk.config.reactions == ["🔥", "❤️", "👏", "🎉"])
        #expect(sdk.config.chat.maxLength == 120)
        #expect(sdk.config.images.maxBytes == 2048)
        #expect(sdk.config.images.formats == ["image/png"])
        #expect(sdk.config.product.nameMaxLength == 40)
    }

    @Test func siLaConfigEstInjoignableLesValeursParDefautRestent() async throws {
        let harness = Harness()

        let sdk = await harness.configuredSDK()

        #expect(harness.http.requests(to: "/v1/config").count == 1)
        #expect(sdk.config == (try Self.fixtureConfig()))
    }

    @Test func uneCleAbsenteOuInvalideRetombeSurSaValeurParDefaut() async throws {
        let harness = Harness()
        harness.http.reply("GET", "/v1/config", body: Data("""
        {"reactions":["🔥","❤️"],"images":{"maxBytes":-1,"formats":["image/png"]},"product":{"nameMaxLength":40},"nouvelleCle":true}
        """.utf8))

        let sdk = await harness.configuredSDK()

        let defaults = try Self.fixtureConfig()
        #expect(sdk.config.reactions == defaults.reactions)
        #expect(sdk.config.chat.maxLength == defaults.chat.maxLength)
        #expect(sdk.config.images.maxBytes == defaults.images.maxBytes)
        #expect(sdk.config.images.formats == ["image/png"])
        #expect(sdk.config.product.nameMaxLength == 40)
    }

    @Test func uneConfigDeMoinsDe5MinutesNEstPasRechargee() async throws {
        let harness = Harness()
        try harness.http.reply("GET", "/v1/config", headers: ["ETag": "\"v1\""], fixture: "config.json")
        let sdk = await harness.configuredSDK()

        harness.clock.advance(by: 299)
        _ = try await sdk.openLive(id: "lv_8f3k2m")

        #expect(harness.http.requests(to: "/v1/config").count == 1)
    }

    @Test func uneConfigDePlusDe5MinutesEstRevalideeAvecSonETag() async throws {
        let harness = Harness()
        try harness.http.reply("GET", "/v1/config", headers: ["ETag": "\"v1\""], fixture: "config.json")
        harness.http.reply("GET", "/v1/config", headers: ["ETag": "\"v2\""], body: Data("""
        {"reactions":["🔥","❤️","👏","🎉"],"chat":{"maxLength":120},"images":{"maxBytes":2048,"formats":["image/png"]},"product":{"nameMaxLength":40}}
        """.utf8))
        let sdk = await harness.configuredSDK()

        harness.clock.advance(by: 301)
        _ = try await sdk.openLive(id: "lv_8f3k2m")

        let requests = harness.http.requests(to: "/v1/config")
        #expect(requests.count == 2)
        #expect(requests.last?.headers["If-None-Match"] == "\"v1\"")
        #expect(sdk.config.chat.maxLength == 120)
    }

    @Test func uneConfigInchangeeEstGardeeEtSonAgeRemisAZero() async throws {
        let harness = Harness()
        harness.http.reply("GET", "/v1/config", headers: ["ETag": "\"v1\""], body: Data("""
        {"reactions":["🔥","❤️","👏","🎉"],"chat":{"maxLength":120},"images":{"maxBytes":2048,"formats":["image/png"]},"product":{"nameMaxLength":40}}
        """.utf8))
        harness.http.reply("GET", "/v1/config", status: 304, headers: ["ETag": "\"v1\""])
        let sdk = await harness.configuredSDK()

        harness.clock.advance(by: 301)
        _ = try await sdk.openLive(id: "lv_8f3k2m")
        harness.clock.advance(by: 299)
        _ = try await sdk.openLive(id: "lv_2b9q7x")

        #expect(harness.http.requests(to: "/v1/config").count == 2)
        #expect(sdk.config.chat.maxLength == 120)
    }

    @Test func changerDeServeurRepartDeLaConfigEmbarqueeSansETag() async throws {
        let harness = Harness()
        harness.http.reply("GET", "/v1/config", headers: ["ETag": "\"v1\""], body: Data("""
        {"reactions":["🔥","❤️","👏","🎉"],"chat":{"maxLength":120},"images":{"maxBytes":2048,"formats":["image/png"]},"product":{"nameMaxLength":40}}
        """.utf8))
        harness.http.reply("GET", "/v1/config", status: 500)
        let sdk = await harness.configuredSDK()
        #expect(sdk.config.chat.maxLength == 120)

        await sdk.configure(serverURL: URL(string: "https://autre.test")!) { "jeton" }

        #expect(harness.http.requests(to: "/v1/config").last?.headers["If-None-Match"] == nil)
        #expect(sdk.config == (try Self.fixtureConfig()))
    }

    @Test func uneConfigInjoignableNEstPasRedemandeeAChaqueOuverture() async throws {
        let harness = Harness()
        let sdk = await harness.configuredSDK()

        harness.clock.advance(by: 60)
        _ = try await sdk.openLive(id: "lv_8f3k2m")
        _ = try await sdk.openLive(id: "lv_2b9q7x")

        #expect(harness.http.requests(to: "/v1/config").count == 1)
    }
}
