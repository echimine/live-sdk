package fr.echimine.live.core

/**
 * Config commune servie par `GET /v1/config`. Le SDK embarque [Defaults], copie de
 * `protocol/fixtures/config.json` ; une clé absente ou invalide reprend sa valeur par défaut.
 */
public data class LiveConfig(
    /** De 4 à 16 emojis ; le premier est la Réaction rapide. */
    val reactions: List<String>,
    val chatMaxLength: Int,
    val imagesMaxBytes: Long,
    val imageFormats: List<String>,
    val productNameMaxLength: Int,
) {
    /** La Réaction envoyée d'un simple appui. */
    val quickReaction: String get() = reactions.first()

    public companion object {
        public val Defaults: LiveConfig = LiveConfig(
            reactions = listOf("❤️", "😂", "😮", "👏", "🔥", "😢", "😍", "🎉", "💯", "👍", "🤯", "🙏"),
            chatMaxLength = 300,
            imagesMaxBytes = 10_485_760,
            imageFormats = listOf("image/jpeg", "image/png", "image/webp"),
            productNameMaxLength = 80,
        )
    }
}
