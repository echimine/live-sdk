import Foundation
import LiveSDK
import Observation

/// Recherche dans la Source de produits de l'app : part 300 ms après la dernière frappe (la précédente est
/// annulée), attend 5 s au plus, garde 20 résultats au plus et écarte ceux que le serveur commun refuserait.
@MainActor
@Observable
public final class ProductSearch {
    public static let debounce: Duration = .milliseconds(300)
    public static let timeout: Duration = .seconds(5)
    public static let maxResults = 20

    public private(set) var suggestions: [ProductSuggestion] = []
    /// Une requête est en cours (après le délai de frappe).
    public private(set) var searching = false
    /// La dernière requête a échoué (exception ou délai dépassé) : « Catalogue indisponible ».
    public private(set) var failed = false

    private let source: any ProductSource
    private let config: LiveConfig
    private let clock: any Clock<Duration>
    private let debounce: Duration
    private let timeout: Duration
    private var query = ""
    private var generation = 0
    private var current: Task<Void, Never>?

    public init(
        source: any ProductSource,
        config: LiveConfig,
        clock: any Clock<Duration> = ContinuousClock(),
        debounce: Duration = ProductSearch.debounce,
        timeout: Duration = ProductSearch.timeout
    ) {
        self.source = source
        self.config = config
        self.clock = clock
        self.debounce = debounce
        self.timeout = timeout
    }

    /// À chaque frappe : annule la recherche précédente et en repart une après le délai.
    public func search(_ query: String) {
        self.query = query
        restart()
    }

    /// « Réessayer » après un échec.
    public func retry() { restart() }

    public func cancel() {
        current?.cancel()
        current = nil
        searching = false
    }

    private func restart() {
        current?.cancel()
        generation += 1
        let id = generation
        let query = query
        current = Task { await run(query, id) }
    }

    private func run(_ query: String, _ id: Int) async {
        suggestions = []
        failed = false
        searching = false
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        do { try await clock.sleep(for: debounce) } catch { return }
        searching = true
        // Deux tâches indépendantes : le délai reste effectif même si la source ignore l'annulation.
        let source = source
        let request = Task { try await source.searchProducts(matching: query) }
        let timer = Task { [clock, timeout] in
            do { try await clock.sleep(for: timeout) } catch { return }
            request.cancel()
            finish(id, with: nil)
        }
        defer { timer.cancel() }
        let results: [ProductSuggestion]? = await withTaskCancellationHandler {
            do { return try await request.value } catch { return nil }
        } onCancel: {
            request.cancel()
        }
        guard !Task.isCancelled else { return }
        finish(id, with: results)
    }

    private func finish(_ id: Int, with results: [ProductSuggestion]?) {
        guard id == generation, searching else { return }
        searching = false
        if let results {
            suggestions = Self.accepted(results, config: config)
        } else {
            failed = true
        }
    }

    /// Les résultats que le serveur commun accepterait, sans `id` vide ni doublon, 20 au plus.
    public static func accepted(_ results: [ProductSuggestion], config: LiveConfig) -> [ProductSuggestion] {
        var seen = Set<String>()
        return Array(results.filter { $0.isValid(in: config) && seen.insert($0.id).inserted }.prefix(maxResults))
    }
}
