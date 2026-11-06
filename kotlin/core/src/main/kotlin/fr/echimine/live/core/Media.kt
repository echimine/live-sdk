package fr.echimine.live.core

/**
 * API réservée aux écrans prêts à l'emploi du SDK (`ui`) : ni stable ni destinée aux App membres.
 */
@RequiresOptIn(
    message = "Réservé aux écrans du SDK Live : cette API peut changer sans préavis.",
    level = RequiresOptIn.Level.ERROR,
)
@Retention(AnnotationRetention.BINARY)
@Target(AnnotationTarget.CLASS, AnnotationTarget.PROPERTY, AnnotationTarget.FUNCTION)
public annotation class InternalLiveSdkApi

/** Accès au serveur média d'un Live : [url] de signal et jeton, renouvelés à chaque `snapshot`. */
@InternalLiveSdkApi
public data class MediaAccess(val url: String, val token: String) {
    override fun toString(): String = "MediaAccess(url=$url, token=…)"
}
