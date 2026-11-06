package fr.echimine.live.ui

import fr.echimine.live.core.LiveError
import fr.echimine.live.core.LiveErrorCode
import org.junit.Assert.assertEquals
import org.junit.Test

/** Un libellé par code d'erreur, le même sur tous les écrans. */
class ErrorMessagesTest {
    private fun message(code: LiveErrorCode, serverMessage: String = "Message du serveur.") =
        LiveError(code, serverMessage).displayMessage()

    @Test
    fun chaqueCodeConnuALeSienQuelQueSoitLeMessageDuServeur() {
        assertEquals("Déjà 5 Co-hôtes à l'écran : retirez-en un pour accepter.", message(LiveErrorCode.CohostLimit))
        assertEquals("Doucement…", message(LiveErrorCode.RateLimited))
        assertEquals("Le produit a changé entre-temps.", message(LiveErrorCode.ProductChanged))
        assertEquals("Ce n'est plus d'actualité.", message(LiveErrorCode.NotFound))
        assertEquals("Connexion perdue. Réessayez.", message(LiveErrorCode.NotConnected))
        assertEquals("Connexion perdue. Réessayez.", message(LiveErrorCode.Timeout))
        assertEquals("Connexion perdue. Réessayez.", message(LiveErrorCode.Network))
        assertEquals("Cette image est illisible.", message(LiveErrorCode.InvalidImage))
        assertEquals("Image trop lourde.", message(LiveErrorCode.PayloadTooLarge))
    }

    @Test
    fun lesAutresCodesReprennentLeMessageDuServeurOuUnLibelleParDefaut() {
        assertEquals("Message du serveur.", message(LiveErrorCode.NotAnimator))
        assertEquals("L'action a échoué. Réessayez.", message(LiveErrorCode.Unknown, serverMessage = "  "))
    }
}
