import Foundation
import Testing
import LiveSDK
import LiveSDKUI

/// Source factice : enregistre les requêtes reçues, répond après un délai ou échoue.
final class FakeProductSource: ProductSource, @unchecked Sendable {
    enum Behaviour: Sendable {
        case results([ProductSuggestion], after: Duration)
        case failure
        /// Ne répond jamais, même annulée : seul le délai maximal libère la recherche.
        case hangs
    }

    private let lock = NSLock()
    private var received: [String] = []
    private var cancelled: [String] = []
    private let behaviour: Behaviour

    init(_ behaviour: Behaviour) { self.behaviour = behaviour }

    var queries: [String] { lock.withLock { received } }
    var cancelledQueries: [String] { lock.withLock { cancelled } }

    func searchProducts(matching query: String) async throws -> [ProductSuggestion] {
        lock.withLock { received.append(query) }
        switch behaviour {
        case .results(let results, let delay):
            do { try await Task.sleep(for: delay) } catch {
                lock.withLock { cancelled.append(query) }
                throw error
            }
            return results
        case .failure:
            throw URLError(.cannotConnectToHost)
        case .hangs:
            while true { try? await Task.sleep(for: .milliseconds(20)) }
        }
    }
}

@MainActor
@Suite("Recherche catalogue : délai de frappe, annulation, délai maximal, 20 résultats valides", .timeLimit(.minutes(1)))
struct ProductSearchTests {
    static let debounce: Duration = .milliseconds(30)
    static let timeout: Duration = .milliseconds(150)

    static func suggestion(_ id: String, name: String = "Mug", price: Int = 1250, currency: String = "EUR", image: String? = nil) -> ProductSuggestion {
        ProductSuggestion(id: id, name: name, priceCents: price, currency: currency, imageURL: image.flatMap(URL.init))
    }

    static func search(_ source: FakeProductSource, config: LiveConfig = .defaults) -> ProductSearch {
        ProductSearch(source: source, config: config, debounce: debounce, timeout: timeout)
    }

    static func eventually(timeout: Duration = .seconds(2), _ condition: @MainActor () -> Bool) async -> Bool {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        while ContinuousClock.now < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return condition()
    }

    /// La recherche a rendu ses résultats ou a échoué.
    static func finished(_ search: ProductSearch) async -> Bool {
        await eventually { !search.searching && (!search.suggestions.isEmpty || search.failed) }
    }

    @Test func seuleLaDerniereFrappeInterrogeLaSourceApresLeDelai() async throws {
        let source = FakeProductSource(.results([Self.suggestion("mug")], after: .zero))
        let search = Self.search(source)

        search.search("m")
        search.search("mu")
        search.search("mug")

        #expect(await Self.finished(search))
        #expect(source.queries == ["mug"])
        #expect(search.suggestions.map(\.id) == ["mug"])
        #expect(!search.failed)
    }

    @Test func uneRechercheVideNInterrogePasLaSource() async throws {
        let source = FakeProductSource(.results([Self.suggestion("mug")], after: .zero))
        let search = Self.search(source)

        search.search("   ")
        try await Task.sleep(for: Self.debounce * 3)

        #expect(source.queries.isEmpty)
        #expect(!search.searching)
    }

    @Test func uneNouvelleFrappeAnnuleLaRequeteEnCours() async throws {
        let source = FakeProductSource(.results([Self.suggestion("mug")], after: .milliseconds(80)))
        let search = Self.search(source)

        search.search("mu")
        #expect(await Self.eventually { source.queries == ["mu"] })
        search.search("mug")

        #expect(await Self.finished(search))
        #expect(source.cancelledQueries == ["mu"])
        #expect(source.queries == ["mu", "mug"])
        #expect(search.suggestions.map(\.id) == ["mug"])
    }

    @Test func auDelaDuDelaiMaximalLeCatalogueEstIndisponibleMemeSiLaSourceIgnoreLAnnulation() async throws {
        let source = FakeProductSource(.hangs)
        let search = Self.search(source)

        search.search("mug")

        #expect(await Self.finished(search))
        #expect(search.failed)
        #expect(search.suggestions.isEmpty)
        #expect(!search.searching)
    }

    @Test func uneSourceEnErreurRendLeCatalogueIndisponiblePuisReessayer() async throws {
        let source = FakeProductSource(.failure)
        let search = Self.search(source)

        search.search("mug")
        #expect(await Self.finished(search))
        #expect(search.failed)

        search.retry()
        #expect(await Self.eventually { source.queries == ["mug", "mug"] })
        #expect(await Self.finished(search))
        #expect(search.failed)
    }

    @Test func vingtResultatsAuPlus() async throws {
        let many = (1...25).map { Self.suggestion("p\($0)") }
        let source = FakeProductSource(.results(many, after: .zero))
        let search = Self.search(source)

        search.search("p")

        #expect(await Self.finished(search))
        #expect(search.suggestions.count == 20)
        #expect(search.suggestions.first?.id == "p1")
    }

    @Test func lesResultatsInvalidesLesIdVidesEtLesDoublonsSontEcartes() throws {
        // `nameMaxLength` vient de la config servie, pas d'une constante des écrans.
        let config = try JSONDecoder().decode(LiveConfig.self, from: Data("""
        {"reactions":["❤️","😂","🔥","👏"],"chat":{"maxLength":300},"images":{"maxBytes":2048,"formats":["image/png"]},"product":{"nameMaxLength":10}}
        """.utf8))
        let results = [
            Self.suggestion("ok"),
            Self.suggestion("", name: "Sans id"),
            Self.suggestion("ok", name: "Doublon"),
            Self.suggestion("long", name: "Un nom trop long"),
            Self.suggestion("graphemes", name: "👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦"),
            Self.suggestion("blank", name: "   "),
            Self.suggestion("price", price: 1_000_001),
            Self.suggestion("currency", currency: "eur"),
            Self.suggestion("http", image: "http://shop.test/mug.png"),
            Self.suggestion("https", image: "https://shop.test/mug.png"),
        ]

        let accepted = ProductSearch.accepted(results, config: config)

        #expect(accepted.map(\.id) == ["ok", "graphemes", "https"])
    }
}
