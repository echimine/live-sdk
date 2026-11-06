package fr.echimine.live.ui

import fr.echimine.live.core.graphemes
import java.text.BreakIterator

/*
 * Caractères visibles côté écrans, sur la seule fabrique de graphèmes du SDK (`core/VisibleText.kt`) :
 * la même règle que `visibleLength`, donc que le serveur commun.
 */

/** Tronque [text] à [max] caractères visibles, sans couper un emoji composé. */
internal fun limitGraphemes(text: String, max: Int): String {
    val iterator = graphemes(text)
    var end = 0
    repeat(max) {
        val next = iterator.next()
        if (next == BreakIterator.DONE) return text
        end = next
    }
    return text.substring(0, end)
}

/** Premier caractère visible du pseudo, en majuscule ; un emoji composé reste entier. */
internal fun initialOf(name: String): String {
    val trimmed = name.trim()
    if (trimmed.isEmpty()) return "?"
    return trimmed.substring(0, graphemes(trimmed).next()).uppercase()
}
