import Foundation
import Testing
@testable import LiveSDK

@Suite("Contrat : chaque fixture se décode puis se réencode à l'identique", .timeLimit(.minutes(1)))
struct ContractFixturesTests {
    @Test func laConfigFaitLAllerRetour() throws {
        let data = try Fixtures.data("config.json")
        let reencoded = try WireCoding.encode(try WireCoding.decode(LiveConfig.self, from: data))
        #expect(try JSONValue.parse(reencoded) == JSONValue.parse(data))
    }

    @Test func chaqueFixtureHTTPEstCouverte() {
        #expect(Fixtures.names(in: "http").sorted() == Self.httpFixtures.keys.sorted())
    }

    @Test(arguments: httpFixtures.keys.sorted())
    func lesMessagesHTTPFontLAllerRetour(fixture: String) throws {
        let data = try Fixtures.data(fixture)
        let roundTrip = try #require(Self.httpFixtures[fixture])
        #expect(try JSONValue.parse(roundTrip(data)) == JSONValue.parse(data))
    }

    @Test(arguments: Fixtures.names(in: "ws/server"))
    func lesMessagesDuServeurFontLAllerRetour(fixture: String) throws {
        let data = try Fixtures.data(fixture)
        let message = try WireCoding.decode(ServerMessage.self, from: data)
        #expect(try JSONValue.parse(WireCoding.encode(message)) == JSONValue.parse(data))
    }

    @Test(arguments: Fixtures.names(in: "ws/client"))
    func lesMessagesDuSDKFontLAllerRetour(fixture: String) throws {
        let data = try Fixtures.data(fixture)
        let message = try WireCoding.decode(ClientMessage.self, from: data)
        #expect(try JSONValue.parse(WireCoding.encode(message)) == JSONValue.parse(data))
    }

    @Test func lesFixturesWebSocketSontTrouvees() {
        #expect(Fixtures.names(in: "ws/client").count >= 18)
        #expect(Fixtures.names(in: "ws/server").count >= 20)
    }

    static let httpFixtures: [String: @Sendable (Data) throws -> Data] = [
        "http/lives.list.response.json": roundTrip(LivesListResponse.self),
        "http/lives.create.request.json": roundTrip(LivesCreateRequest.self),
        "http/lives.create.response.json": roundTrip(LivesCreateResponse.self),
        "http/images.upload.response.json": roundTrip(ImagesUploadResponse.self),
        "http/error.json": roundTrip(HTTPErrorBody.self),
    ]

    static func roundTrip<T: Codable>(_ type: T.Type) -> @Sendable (Data) throws -> Data {
        { data in try WireCoding.encode(try WireCoding.decode(type, from: data)) }
    }
}
