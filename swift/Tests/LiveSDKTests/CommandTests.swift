import Foundation
import Testing
import LiveSDK

@MainActor
@Suite("Commandes : succès sur ack, erreur à code fermé", .timeLimit(.minutes(1)))
struct CommandTests {
    @Test func uneCommandeAcquitteeReussit() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json")

        async let result: Void = session.send(.sendMessage(text: "Elles existent en 42 ?"))
        let sent = try await Self.lastCommand(on: connection)
        #expect(sent["type"] == .string("sendMessage"))
        #expect(sent["text"] == .string("Elles existent en 42 ?"))
        connection.push(#"{"type":"ack","ref":\#(Self.quoted(sent["ref"]))}"#)

        try await result
    }

    @Test func uneCommandeRefuseeRenvoieLeCodeEtLeDelai() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json")

        let result = Task { try await session.send(.sendMessage(text: "spam")) }
        let sent = try await Self.lastCommand(on: connection)
        connection.push(#"{"type":"error","ref":\#(Self.quoted(sent["ref"])),"code":"rate_limited","message":"Doucement…","retryAfterMs":4200}"#)

        await #expect(throws: LiveCommandError(code: .rateLimited, message: "Doucement…", retryAfter: .milliseconds(4200))) {
            try await result.value
        }
    }

    @Test func chaqueCommandeEstResolueParSaPropreReference() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json")

        async let premiere: Void = session.send(.shadowban(participantId: "twitch:u_88"))
        let premiereEnvoyee = try await Self.lastCommand(on: connection, count: 2)
        let seconde = Task { try await session.send(.ban(participantId: "snapcore:u_310")) }
        let secondeEnvoyee = try await Self.lastCommand(on: connection, count: 3)
        #expect(premiereEnvoyee["ref"] != secondeEnvoyee["ref"])

        connection.push(#"{"type":"error","ref":\#(Self.quoted(secondeEnvoyee["ref"])),"code":"not_animator","message":"Non."}"#)
        connection.push(#"{"type":"ack","ref":\#(Self.quoted(premiereEnvoyee["ref"]))}"#)

        try await premiere
        await #expect(throws: LiveCommandError(code: .notAnimator, message: "Non.")) {
            try await seconde.value
        }
    }

    @Test func unEnvoiRateLibereLAppelantAvecDisconnected() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json")
        connection.failSends()

        let outcome = Outcome()
        Task {
            do { try await session.send(.requestToJoin) } catch { outcome.error = error }
            outcome.done = true
        }

        #expect(await eventually { outcome.done })
        #expect(outcome.error as? LiveCommandError == LiveCommandError(code: .disconnected, message: ""))
    }

    @Test func lesCommandesPartentDansLOrdreOuEllesSontEmises() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json")

        let texts = (1...20).map { "message \($0)" }
        texts.forEach { text in Task { try? await session.send(.sendMessage(text: text)) } }

        #expect(await eventually { connection.sent.count == 21 })
        let sentTexts = connection.sentJSON.dropFirst().map { json -> String in
            guard case .object(let object) = json, case .string(let text) = object["text"] else { return "" }
            return text
        }
        #expect(sentTexts == texts)
    }

    static func lastCommand(on connection: FakeConnection, count: Int = 2) async throws -> [String: JSONValue] {
        _ = await eventually { connection.sent.count >= count }
        guard case .object(let object) = try #require(connection.sentJSON.dropFirst(count - 1).first) else {
            Issue.record("commande illisible")
            return [:]
        }
        return object
    }

    static func quoted(_ value: JSONValue?) -> String {
        guard case .string(let text) = value else { return "null" }
        return "\"\(text)\""
    }
}

@MainActor
final class Outcome {
    var done = false
    var error: (any Error)?
}
