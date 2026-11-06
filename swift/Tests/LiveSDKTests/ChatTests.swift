import Foundation
import Testing
import LiveSDK

@MainActor
@Suite("Chat : envoi validé avant le fil, verrou après rate_limited", .timeLimit(.minutes(1)))
struct ChatTests {
    static func joined(maxLength: Int = 300, harness: Harness = Harness()) async throws -> (LiveSession, FakeConnection) {
        harness.http.reply("GET", "/v1/config", body: Data("""
        {"reactions":["❤️","😂","🔥","👏"],"chat":{"maxLength":\(maxLength)},"images":{"maxBytes":2048,"formats":["image/png"]},"product":{"nameMaxLength":80}}
        """.utf8))
        return try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json", harness: harness)
    }

    @Test func unMessageEstEnvoyeSansSesEspacesDeBord() async throws {
        let (session, connection) = try await Self.joined()

        let sending = Task { try await session.sendMessage("  Elles existent en 42 ?\n") }
        let sent = try await CommandTests.lastCommand(on: connection)
        connection.push(#"{"type":"ack","ref":\#(CommandTests.quoted(sent["ref"]))}"#)

        try await sending.value
        #expect(sent["type"] == .string("sendMessage"))
        #expect(sent["text"] == .string("Elles existent en 42 ?"))
    }

    @Test(arguments: ["", "   \n "])
    func unMessageVideEstRefuseSansRienEnvoyer(text: String) async throws {
        let (session, connection) = try await Self.joined()

        await #expect(throws: LiveCommandError(code: .invalidMessage, message: "Un message fait de 1 à 300 caractères visibles.")) {
            try await session.sendMessage(text)
        }
        #expect(connection.sent.count == 1)
    }

    @Test func laLongueurMaximaleVientDeLaConfigEtCompteLesCaracteresVisibles() async throws {
        let (session, connection) = try await Self.joined(maxLength: 5)

        await #expect(throws: LiveCommandError(code: .invalidMessage, message: "Un message fait de 1 à 5 caractères visibles.")) {
            try await session.sendMessage("abcdef")
        }
        #expect(connection.sent.count == 1)

        let sending = Task { try await session.sendMessage("abcd👩‍👩‍👧‍👦") }
        let sent = try await CommandTests.lastCommand(on: connection)
        connection.push(#"{"type":"ack","ref":\#(CommandTests.quoted(sent["ref"]))}"#)
        try await sending.value
    }

    @Test func apresUnRateLimitedLeChatEstVerrouilleLeTempsIndiquePuisRouvert() async throws {
        let harness = Harness()
        harness.clock.holdSleeps()
        let (session, connection) = try await Self.joined(harness: harness)

        let sending = Task { try await session.sendMessage("spam") }
        let sent = try await CommandTests.lastCommand(on: connection)
        connection.push(#"{"type":"error","ref":\#(CommandTests.quoted(sent["ref"])),"code":"rate_limited","message":"Doucement…","retryAfterMs":4000}"#)
        await #expect(throws: LiveCommandError(code: .rateLimited, message: "Doucement…", retryAfter: .milliseconds(4000))) {
            try await sending.value
        }
        #expect(session.chatLocked)

        harness.clock.advance(by: 1)
        await #expect(throws: LiveCommandError(code: .rateLimited, message: "Doucement…", retryAfter: .milliseconds(3000))) {
            try await session.sendMessage("encore")
        }
        #expect(connection.sent.count == 2)

        harness.clock.advance(by: 3)
        #expect(await eventually { !session.chatLocked })
    }
}
