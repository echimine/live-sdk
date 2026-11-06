package fr.echimine.live.ui

import java.text.BreakIterator

/** Découpe en caractères visibles : un emoji composé compte pour un. */
internal fun graphemes(text: String): BreakIterator =
    BreakIterator.getCharacterInstance().apply { setText(text) }

/** Tronque [text] à [max] caractères visibles, sans couper un emoji composé. */
internal fun limitGraphemes(text: String, max: Int): String {
    val graphemes = graphemes(text)
    var end = 0
    repeat(max) {
        val next = graphemes.next()
        if (next == BreakIterator.DONE) return text
        end = next
    }
    return text.substring(0, end)
}

internal fun graphemeCount(text: String): Int {
    val graphemes = graphemes(text)
    var count = 0
    while (graphemes.next() != BreakIterator.DONE) count++
    return count
}
