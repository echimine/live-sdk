@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package fr.echimine.live.ui

import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.IOException

/** Recherche dans la Source de produits de l'App membre, pilotée par sa propre interface. */
class ProductSearchTest {
    private val queries = mutableListOf<String>()

    private fun suggestion(id: String, name: String = "Produit $id", price: Int = 1000, currency: String = "EUR", image: String? = null) =
        ProductSuggestion(id, name, price, currency, image)

    private fun TestScope.search(source: ProductSource): ProductSearch =
        ProductSearch(source, backgroundScope, nameMaxLength = { 80 })

    @Test
    fun laRechercheAttend300msApresLaDerniereFrappe() = runTest {
        val search = search { query -> queries += query; listOf(suggestion("p1", "Baskets $query")) }

        search.onQueryChange("bas")
        advanceTimeBy(200)
        search.onQueryChange("bask")
        advanceTimeBy(299)
        assertEquals(emptyList<String>(), queries)
        assertEquals(ProductSearchState.Idle, search.state.value)

        advanceTimeBy(2)
        assertEquals(listOf("bask"), queries)
        assertEquals(ProductSearchState.Results(listOf(suggestion("p1", "Baskets bask"))), search.state.value)
    }

    @Test
    fun uneFrappeAnnuleLaRechercheEnCours() = runTest {
        var cancelled = 0
        val search = search { query ->
            queries += query
            if (query == "a") {
                try {
                    awaitCancellation()
                } finally {
                    cancelled++
                }
            }
            listOf(suggestion("p-$query"))
        }

        search.onQueryChange("a")
        advanceTimeBy(301)
        assertEquals(ProductSearchState.Loading, search.state.value)
        search.onQueryChange("ab")
        runCurrent()
        assertEquals(1, cancelled)

        advanceTimeBy(301)
        assertEquals(listOf("a", "ab"), queries)
        assertEquals(ProductSearchState.Results(listOf(suggestion("p-ab"))), search.state.value)
    }

    @Test
    fun auPlus20ResultatsValidesSontGardes() = runTest {
        val search = search {
            listOf(
                suggestion("vide", name = "  "),
                suggestion("long", name = "x".repeat(81)),
                suggestion("negatif", price = -1),
                suggestion("cher", price = 1_000_001),
                suggestion("devise", currency = "eur"),
                suggestion("http", image = "http://cdn.example/a.jpg"),
                suggestion("ok", name = "  Casquette  ", image = "https://cdn.example/a.jpg"),
            ) + (1..30).map { suggestion("n$it") }
        }

        search.onQueryChange("c")
        advanceTimeBy(301)

        val results = (search.state.value as ProductSearchState.Results).suggestions
        assertEquals(listOf("ok") + (1..19).map { "n$it" }, results.map { it.id })
        assertEquals("Casquette", results.first().name)
    }

    @Test
    fun lesSuggestionsSansIdSontEcarteesEtLesDoublonsDedoublonnes() = runTest {
        val search = search {
            listOf(
                suggestion("", name = "Sans identifiant"),
                suggestion("   ", name = "Identifiant blanc"),
                suggestion("p1", name = "Première"),
                suggestion("p2"),
                suggestion("p1", name = "Doublon"),
                suggestion("p3"),
            )
        }

        search.onQueryChange("p")
        advanceTimeBy(301)

        val results = (search.state.value as ProductSearchState.Results).suggestions
        assertEquals(listOf("p1", "p2", "p3"), results.map { it.id })
        assertEquals("Première", results.first().name) // la première occurrence d'un `id` l'emporte
    }

    @Test
    fun unCatalogueEnPanneOuTropLentEstIndisponiblePuisReessayable() = runTest {
        var failing = true
        val search = search { query ->
            queries += query
            if (failing) throw IOException("catalogue en panne")
            listOf(suggestion("p1"))
        }

        search.onQueryChange("bas")
        advanceTimeBy(301)
        assertEquals(ProductSearchState.Unavailable, search.state.value)

        failing = false
        search.retry()
        runCurrent()
        assertEquals(listOf("bas", "bas"), queries)
        assertEquals(ProductSearchState.Results(listOf(suggestion("p1"))), search.state.value)

        val slow = search { awaitCancellation() }
        slow.onQueryChange("bas")
        advanceTimeBy(300 + 4_999)
        assertEquals(ProductSearchState.Loading, slow.state.value)
        advanceTimeBy(2)
        assertEquals(ProductSearchState.Unavailable, slow.state.value)
    }

    @Test
    fun uneRequeteVideNInterrogePasLeCatalogue() = runTest {
        val search = search { query -> queries += query; listOf(suggestion("p1")) }

        search.onQueryChange("bas")
        advanceTimeBy(301)
        search.onQueryChange("   ")
        advanceTimeBy(1_000)

        assertEquals(listOf("bas"), queries)
        assertEquals(ProductSearchState.Idle, search.state.value)
    }
}
