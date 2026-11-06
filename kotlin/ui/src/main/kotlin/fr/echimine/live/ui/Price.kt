package fr.echimine.live.ui

import java.math.BigDecimal
import java.text.DecimalFormatSymbols
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/*
 * Prix d'un produit : en centimes dans le contrat (1/100 de la devise, quelle qu'elle soit),
 * affichés et saisis selon la locale du téléphone.
 */

/** Prix en centimes de [currency], formaté selon la locale du téléphone. */
internal fun formatPrice(cents: Int, currency: String): String {
    val format = NumberFormat.getCurrencyInstance(Locale.getDefault())
    runCatching { Currency.getInstance(currency) }.getOrNull()?.let { format.currency = it }
    return format.format(BigDecimal(cents).movePointLeft(2))
}

/** Prix saisi (« 89,99 », « 89.99 ») en centimes ; `null` s'il est illisible. */
internal fun parsePrice(text: String): Int? {
    val normalized = text.trim().replace(" ", "").replace(" ", "").replace(" ", "").replace(',', '.')
    if (normalized.isEmpty() || normalized.count { it == '.' } > 1) return null
    val amount = normalized.toBigDecimalOrNull() ?: return null
    if (amount.scale() > 2) return null
    return runCatching { amount.movePointRight(2).intValueExact() }.getOrNull()
}

/** Centimes en saisie modifiable (« 89,99 »), avec le séparateur décimal de la locale. */
internal fun editablePrice(cents: Int): String {
    val separator = DecimalFormatSymbols.getInstance().decimalSeparator
    return BigDecimal(cents).movePointLeft(2).toPlainString().replace('.', separator)
}

/** Devise de la locale du téléphone, pour préremplir la saisie manuelle. */
internal fun localCurrency(): String = runCatching { Currency.getInstance(Locale.getDefault()).currencyCode }.getOrNull() ?: "EUR"
