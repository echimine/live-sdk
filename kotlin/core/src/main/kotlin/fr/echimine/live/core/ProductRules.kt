package fr.echimine.live.core

/** Prix maximal d'un produit, en centimes. */
public const val MAX_PRODUCT_PRICE: Int = 1_000_000

private val CURRENCY = Regex("[A-Z]{3}")

/**
 * Ce qui rend un produit invalide aux yeux du serveur commun, ou `null` s'il est valide.
 * [name] est attendu sans espaces autour ; sa longueur se compte comme le serveur, en unités UTF-16.
 */
@InternalLiveSdkApi
public fun productProblem(name: String, price: Int, currency: String, imageUrl: String?, nameMaxLength: Int): String? = when {
    name.length !in 1..nameMaxLength -> "Un nom de 1 à $nameMaxLength caractères."
    price !in 0..MAX_PRODUCT_PRICE -> "Un prix de 0 à ${MAX_PRODUCT_PRICE / 100} unités."
    !CURRENCY.matches(currency) -> "Une devise en code ISO 4217 (EUR, USD…)."
    imageUrl != null && !imageUrl.startsWith("https://") -> "Une image en https."
    else -> null
}
