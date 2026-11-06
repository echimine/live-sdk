package fr.echimine.live.ui

import fr.echimine.live.core.LiveError
import fr.echimine.live.core.LiveErrorCode
import fr.echimine.live.core.MAX_COHOSTS

/**
 * Le libellé à montrer pour une erreur du cœur : un par code, le même sur tous les écrans.
 * Le message du serveur commun ne sert que pour les codes sans libellé propre.
 */
internal fun LiveError.displayMessage(): String = when (code) {
    LiveErrorCode.CohostLimit -> "Déjà $MAX_COHOSTS Co-hôtes à l'écran : retirez-en un pour accepter."
    LiveErrorCode.RateLimited -> "Doucement…"
    LiveErrorCode.ProductChanged -> "Le produit a changé entre-temps."
    LiveErrorCode.NotFound -> "Ce n'est plus d'actualité."
    LiveErrorCode.NotConnected, LiveErrorCode.Timeout, LiveErrorCode.Network -> "Connexion perdue. Réessayez."
    LiveErrorCode.InvalidImage -> "Cette image est illisible."
    LiveErrorCode.PayloadTooLarge -> "Image trop lourde."
    else -> message.ifBlank { "L'action a échoué. Réessayez." }
}
