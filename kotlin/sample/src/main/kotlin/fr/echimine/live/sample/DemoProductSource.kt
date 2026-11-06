package fr.echimine.live.sample

import fr.echimine.live.ui.ProductSource
import fr.echimine.live.ui.ProductSuggestion
import kotlinx.coroutines.delay
import java.io.IOException
import java.text.Normalizer

/**
 * Source de produits factice : un petit catalogue en mémoire, avec un peu de latence.
 * Taper « panne » simule un catalogue indisponible, pour essayer « Réessayer ».
 */
object DemoProductSource : ProductSource {
    private val catalog = listOf(
        ProductSuggestion("sku-001", "Baskets Runner X", 8999, "EUR", "https://picsum.photos/seed/runner/600"),
        ProductSuggestion("sku-002", "Casquette Crosslive", 2500, "EUR", "https://picsum.photos/seed/casquette/600"),
        ProductSuggestion("sku-003", "Sweat à capuche", 5900, "EUR", "https://picsum.photos/seed/sweat/600"),
        ProductSuggestion("sku-004", "Gourde isotherme", 1990, "EUR", "https://picsum.photos/seed/gourde/600"),
        ProductSuggestion("sku-005", "Montre GPS", 24900, "EUR", "https://picsum.photos/seed/montre/600"),
        ProductSuggestion("sku-006", "Écouteurs sans fil", 12900, "EUR", null),
        ProductSuggestion("sku-007", "Tote bag", 1500, "EUR", "https://picsum.photos/seed/tote/600"),
        ProductSuggestion("sku-008", "Figurine édition Tokyo", 4800, "JPY", "https://picsum.photos/seed/tokyo/600"),
    )

    override suspend fun searchProducts(query: String): List<ProductSuggestion> {
        delay(400)
        val needle = fold(query)
        if (needle == "panne") throw IOException("Catalogue de démo en panne.")
        return catalog.filter { fold(it.name).contains(needle) }
    }

    /** Minuscules sans accents : « ecouteurs » trouve « Écouteurs ». */
    private fun fold(text: String): String =
        Normalizer.normalize(text.trim().lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{M}"), "")
}
