package fr.echimine.live.core

import java.text.BreakIterator

/**
 * Découpe [text] en caractères visibles (graphèmes) : un emoji composé compte pour un.
 * Seule fabrique de [BreakIterator] du SDK, partagée avec les écrans (compteurs, troncature, initiale).
 */
@InternalLiveSdkApi
public fun graphemes(text: String): BreakIterator =
    BreakIterator.getCharacterInstance().apply { setText(text) }

/**
 * Nombre de caractères visibles (graphèmes), comme le serveur commun : un emoji composé compte pour un.
 * Partagé avec les écrans, pour que leurs compteurs suivent la règle d'envoi.
 */
@InternalLiveSdkApi
public fun visibleLength(text: String): Int {
    val iterator = graphemes(text)
    var count = 0
    while (iterator.next() != BreakIterator.DONE) count++
    return count
}
