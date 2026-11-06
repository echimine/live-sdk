import Foundation
import ImageIO
import UniformTypeIdentifiers
import CoreGraphics
import Testing
import LiveSDK

@MainActor
@Suite("Produits et achats", .timeLimit(.minutes(1)))
struct ProductTests {
    @Test func uneImageEstReduiteEtEnvoyeeAvantLEpinglage() async throws {
        let harness = Harness()
        harness.http.reply("POST", "/v1/images", body: Data(#"{"url":"https://live.test/images/photo.jpg"}"#.utf8))
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json", harness: harness)
        let context = try #require(CGContext(data: nil, width: 2400, height: 1200, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        let image = try #require(context.makeImage())
        let data = NSMutableData()
        let destination = try #require(CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, nil)
        #expect(CGImageDestinationFinalize(destination))
        let sending = Task { try await session.pinProduct(name: "  Photo  ", price: 1990, currency: "EUR", image: .data(data as Data)) }
        let sent = try await CommandTests.lastCommand(on: connection)
        let request = try #require(harness.http.requests(to: "/v1/images").first)
        #expect(request.method == "POST")
        #expect(request.headers["Content-Type"] == "image/jpeg")
        #expect(request.headers["Authorization"]?.hasPrefix("Bearer jeton-") == true)
        let uploadedBody = try #require(request.body)
        let source = try #require(CGImageSourceCreateWithData(uploadedBody as CFData, nil))
        let reduced = try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
        #expect(reduced.width == 1024)
        #expect(reduced.height == 512)
        #expect(sent["name"] == .string("Photo"))
        #expect(sent["imageUrl"] == .string("https://live.test/images/photo.jpg"))
        connection.push(#"{"type":"ack","ref":\#(CommandTests.quoted(sent["ref"]))}"#)
        try await sending.value
    }

    @Test func uneURLDeCatalogueEstTransmiseSansUpload() async throws {
        let harness = Harness()
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json", harness: harness)
        let sending = Task { try await session.pinProduct(name: "Mug", price: 1200, currency: "EUR", image: .url(URL(string: "https://shop.test/mug.png")!)) }
        let sent = try await CommandTests.lastCommand(on: connection)
        #expect(harness.http.requests(to: "/v1/images").isEmpty)
        #expect(sent["imageUrl"] == .string("https://shop.test/mug.png"))
        connection.push(#"{"type":"ack","ref":\#(CommandTests.quoted(sent["ref"]))}"#)
        try await sending.value
    }

    @Test func unUploadRefuseNeDeclenchePasDEpinglage() async throws {
        let harness = Harness()
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json", harness: harness)
        do {
            try await session.pinProduct(name: "Mug", price: 1200, currency: "EUR", image: .data(Data("invalide".utf8)))
            Issue.record("Une image illisible doit être refusée")
        } catch {
            #expect(error.code == .invalidImage)
        }
        #expect(connection.sent.count == 1)
        #expect(harness.http.requests(to: "/v1/images").isEmpty)
    }

    @Test func uneErreurHTTPConserveLeProduitEtNeLEpinglePas() async throws {
        let harness = Harness()
        harness.http.reply("POST", "/v1/images", status: 413, body: Data(#"{"error":{"code":"payload_too_large","message":"Image trop lourde"}}"#.utf8))
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json", harness: harness)
        let previous = session.pinnedProduct
        let context = try #require(CGContext(data: nil, width: 2, height: 2, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        let image = try #require(context.makeImage())
        let data = NSMutableData()
        let destination = try #require(CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, nil)
        #expect(CGImageDestinationFinalize(destination))
        await #expect(throws: LiveCommandError(code: .payloadTooLarge, message: "Image trop lourde")) {
            try await session.pinProduct(name: "Photo", price: 100, currency: "EUR", image: .data(data as Data))
        }
        #expect(connection.sent.count == 1)
        #expect(session.pinnedProduct == previous)
    }

    @Test(arguments: [
        (415, #"{"error":{"code":"unsupported_media_type","message":"Formats acceptés : image/png."}}"#, LiveErrorCode.unsupportedMediaType),
        (413, "", LiveErrorCode.payloadTooLarge),
        (500, "", LiveErrorCode.network),
    ])
    func unRefusHTTPDeLImageDonneUnCodeFerme(status: Int, body: String, expected: LiveErrorCode) async throws {
        let harness = Harness()
        harness.http.reply("POST", "/v1/images", status: status, body: Data(body.utf8))
        let (session, _) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json", harness: harness)
        let png = try Self.tinyPNG()
        do {
            try await session.pinProduct(name: "Photo", price: 100, currency: "EUR", image: .data(png))
            Issue.record("Le refus HTTP doit faire échouer l’épinglage")
        } catch {
            #expect(error.code == expected)
        }
    }

    @Test func unServeurInjoignablePourLImageDonneNetwork() async throws {
        let harness = Harness()
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.host.json", harness: harness)
        let png = try Self.tinyPNG()
        do {
            try await session.pinProduct(name: "Photo", price: 100, currency: "EUR", image: .data(png))
            Issue.record("Un serveur injoignable doit faire échouer l’épinglage")
        } catch {
            #expect(error.code == .network)
        }
        #expect(connection.sent.count == 1)
    }

    static func tinyPNG() throws -> Data {
        let context = try #require(CGContext(data: nil, width: 2, height: 2, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        let image = try #require(context.makeImage())
        let data = NSMutableData()
        let destination = try #require(CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, nil)
        #expect(CGImageDestinationFinalize(destination))
        return data as Data
    }

    @Test func seulesLesNouvellesAnnoncesDeclenchentUnEvenementAchat() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json")
        let stream = session.events()
        let next = Task { () -> ChatMessage? in
            for await event in stream {
                if case .purchase(let message) = event { return message }
            }
            return nil
        }
        // L’annonce du snapshot ne doit pas déclencher de toast.
        let fixture = try Fixtures.data("ws/server/chatMessage.purchase.json")
        let text = try #require(String(data: fixture, encoding: .utf8))
        connection.push(text.replacingOccurrences(of: "msg_0194", with: "msg_new"))
        let announcement = await next.value
        #expect(announcement?.id == "msg_new")
        #expect(await eventually { session.messages.last?.id == "msg_new" })
    }

    @Test func unAchatGardeLeProduitConfirmeEtExposeProductChanged() async throws {
        let (session, connection) = try await LiveSessionTests.joined(fixture: "ws/server/snapshot.viewer.json")
        let sending = Task { try await session.purchase(productId: "ancien-produit") }
        let sent = try await CommandTests.lastCommand(on: connection)
        #expect(sent["productId"] == .string("ancien-produit"))
        connection.push(#"{"type":"error","ref":\#(CommandTests.quoted(sent["ref"])),"code":"product_changed","message":"Le produit a changé."}"#)
        await #expect(throws: LiveCommandError(code: .productChanged, message: "Le produit a changé.")) { try await sending.value }
    }
}
