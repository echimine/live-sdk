package fr.echimine.live.core

import java.text.BreakIterator

/**
 * Nombre de caractères visibles (graphèmes), comme le serveur commun : un emoji composé compte pour un.
 * Partagé avec les écrans, pour que leurs compteurs suivent la règle d'envoi.
 */
@InternalLiveSdkApi
public fun visibleLength(text: String): Int {
    val graphemes = BreakIterator.getCharacterInstance().apply { setText(text) }
    var count = 0
    while (graphemes.next() != BreakIterator.DONE) count++
    return count
}
