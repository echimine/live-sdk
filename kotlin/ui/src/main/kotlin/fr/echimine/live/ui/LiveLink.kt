package fr.echimine.live.ui

/**
 * Identifiant d'un Live tiré de ce qu'un Participant a collé : l'identifiant seul (`lv_8f3k2m`)
 * ou un lien qui le contient (`https://…/lives/lv_8f3k2m?ref=…`). `null` si rien d'exploitable.
 */
public fun liveIdFrom(input: String): String? {
    val withoutQuery = input.trim().substringBefore('?').substringBefore('#').trimEnd('/')
    val candidate = withoutQuery.substringAfterLast('/')
    return candidate.takeIf { it.isNotEmpty() && it.all { c -> c.isLetterOrDigit() || c == '_' || c == '-' } }
}
