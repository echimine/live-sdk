package fr.echimine.live.ui

import fr.echimine.live.core.productProblem
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

/**
 * Source de produits : le catalogue de l'App membre, que l'Animateur peut rechercher pour préremplir
 * le produit à épingler. Facultative ; le serveur commun ne la connaît jamais.
 * Une exception signale un catalogue indisponible : la saisie manuelle reste possible.
 */
public fun interface ProductSource {
    public suspend fun searchProducts(query: String): List<ProductSuggestion>
}

/** Un produit du catalogue de l'App membre. */
public data class ProductSuggestion(
    /** Identifiant dans le catalogue ; jamais envoyé au serveur commun. */
    val id: String,
    val name: String,
    /** En centimes. */
    val priceCents: Int,
    /** Code ISO 4217. */
    val currency: String,
    /** https ; transmise telle quelle à l'épinglage. */
    val imageUrl: String? = null,
)

internal sealed interface ProductSearchState {
    data object Idle : ProductSearchState

    data object Loading : ProductSearchState

    data class Results(val suggestions: List<ProductSuggestion>) : ProductSearchState

    /** « Catalogue indisponible » : en panne, trop lent ou illisible. */
    data object Unavailable : ProductSearchState
}

/**
 * Recherche dans une [ProductSource] : 300 ms après la dernière frappe, la précédente annulée,
 * 5 s au plus, 20 résultats au plus, les produits que le serveur commun refuserait écartés,
 * ainsi que ceux sans `id` ; un `id` en double ne garde que sa première occurrence.
 */
internal class ProductSearch(
    private val source: ProductSource,
    private val scope: CoroutineScope,
    private val nameMaxLength: () -> Int,
) {
    private val stateFlow = MutableStateFlow<ProductSearchState>(ProductSearchState.Idle)
    val state: StateFlow<ProductSearchState> = stateFlow.asStateFlow()

    private var job: Job? = null
    private var query = ""

    fun onQueryChange(query: String) {
        this.query = query.trim()
        launchSearch(debounce = true)
    }

    /** « Réessayer » : relance aussitôt la dernière recherche, ou [query] si elle est donnée. */
    fun retry(query: String = this.query) {
        this.query = query.trim()
        launchSearch(debounce = false)
    }

    private fun launchSearch(debounce: Boolean) {
        job?.cancel()
        val query = query
        if (query.isEmpty()) {
            stateFlow.value = ProductSearchState.Idle
            return
        }
        job = scope.launch {
            if (debounce) delay(DEBOUNCE)
            stateFlow.value = ProductSearchState.Loading
            val found = try {
                withTimeoutOrNull(TIMEOUT) { source.searchProducts(query) }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                null
            }
            stateFlow.value = found?.let { ProductSearchState.Results(valid(it)) } ?: ProductSearchState.Unavailable
        }
    }

    private fun valid(suggestions: List<ProductSuggestion>): List<ProductSuggestion> {
        val max = nameMaxLength()
        return suggestions.asSequence()
            .filter { it.id.isNotBlank() }
            .distinctBy { it.id }
            .map { it.copy(name = it.name.trim()) }
            .filter { productProblem(it.name, it.priceCents, it.currency, it.imageUrl, max) == null }
            .take(MAX_RESULTS)
            .toList()
    }

    private companion object {
        val DEBOUNCE = 300.milliseconds
        val TIMEOUT = 5.seconds
        const val MAX_RESULTS = 20
    }
}
