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
        let messages = Fixtures.names(in: "http").filter { !$0.hasPrefix("http/error.") }
        #expect(messages.sorted() == Self.httpFixtures.keys.sorted())
        #expect(Fixtures.names(in: "http").contains("http/error.rate_limited.json"))
    }

    @Test(arguments: Fixtures.names(in: "http"))
    func lesMessagesHTTPFontLAllerRetour(fixture: String) throws {
        let data = try Fixtures.data(fixture)
        // `error.<code>.json` : un corps d'erreur, un fichier par code.
        let roundTrip = try #require(Self.httpFixtures[fixture] ?? (fixture.hasPrefix("http/error.") ? Self.roundTrip(HTTPErrorBody.self) : nil))
        #expect(try JSONValue.parse(roundTrip(data)) == JSONValue.parse(data))
    }

    @Test(arguments: Fixtures.names(in: "ws/server"))
    func lesMessagesDuServeurFontLAllerRetour(fixture: String) throws {
        let data = try Fixtures.data(fixture)
        let message = try WireCoding.decode(ServerMessage.self, from: data)
        // Une fixture qui tombe en `.unknown` passerait l'aller-retour sans être comprise : seule `unknown*` y a droit.
        if case .unknown(let type) = message, !fixture.hasPrefix("ws/server/unknown") {
            Issue.record("Fixture \(fixture) non comprise par le SDK (type \(type))")
        }
        #expect(try JSONValue.parse(WireCoding.encode(message)) == JSONValue.parse(data))
    }

    @Test(arguments: Fixtures.names(in: "ws/client"))
    func lesMessagesDuSDKFontLAllerRetour(fixture: String) throws {
        let data = try Fixtures.data(fixture)
        let message = try WireCoding.decode(ClientMessage.self, from: data)
        #expect(try JSONValue.parse(WireCoding.encode(message)) == JSONValue.parse(data))
    }

    /// Chaque type de message connu du SDK a au moins une fixture, et chaque fixture porte un type connu.
    @Test func chaqueTypeDeMessageWebSocketAUneFixture() throws {
        let serverTypes = try Self.types(in: "ws/server")
        let clientTypes = try Self.types(in: "ws/client")
        #expect(serverTypes == Self.serverMessageTypes)
        #expect(clientTypes == Self.clientMessageTypes)
    }

    static let serverMessageTypes: Set<String> = [
        "ack", "error", "snapshot", "replaced", "hostDisconnected", "hostReconnected", "liveEnded",
        "joinRequested", "joinRequestCancelled", "joinDeclined", "roleChanged", "audience", "reactions",
        "chatMessage", "messageDeleted", "productPinned", "productUnpinned", "banned", "moderationChanged",
    ]

    static let clientMessageTypes: Set<String> = [
        "join", "endLive", "requestToJoin", "cancelJoinRequest", "acceptJoin", "declineJoin", "leaveStage",
        "removeCohost", "sendMessage", "deleteMessage", "pinProduct", "unpinProduct", "purchase", "react",
        "shadowban", "unshadowban", "ban",
    ]

    static func types(in directory: String) throws -> Set<String> {
        var types = Set<String>()
        for fixture in Fixtures.names(in: directory) where !fixture.hasPrefix("\(directory)/unknown") {
            guard case .object(let object) = try JSONValue.parse(Fixtures.data(fixture)),
                  case .string(let type) = object["type"] else {
                Issue.record("Fixture \(fixture) sans champ `type`")
                continue
            }
            types.insert(type)
        }
        return types
    }

    static let httpFixtures: [String: @Sendable (Data) throws -> Data] = [
        "http/lives.list.response.json": roundTrip(LivesListResponse.self),
        "http/lives.create.request.json": roundTrip(LivesCreateRequest.self),
        "http/lives.create.response.json": roundTrip(LivesCreateResponse.self),
        "http/lives.summary.response.json": roundTrip(LiveRecap.self),
        "http/images.upload.response.json": roundTrip(ImagesUploadResponse.self),
    ]

    static func roundTrip<T: Codable>(_ type: T.Type) -> @Sendable (Data) throws -> Data {
        { data in try WireCoding.encode(try WireCoding.decode(type, from: data)) }
    }
}
