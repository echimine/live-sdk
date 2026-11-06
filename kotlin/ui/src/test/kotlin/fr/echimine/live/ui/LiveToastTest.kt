package fr.echimine.live.ui

import fr.echimine.live.core.ChatMessage
import fr.echimine.live.core.LiveEvent
import fr.echimine.live.core.Participant
import fr.echimine.live.core.PurchasedProduct
import fr.echimine.live.core.Role
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** Les événements du Live qui s'annoncent en toast, et ceux qui s'animent ailleurs. */
class LiveToastTest {
    @Test
    fun unRefusDeLHoteSAnnonceAuSpectateur() {
        assertEquals(LiveToast("✋", "L'Hôte n'a pas retenu votre demande de montée."), toastOf(LiveEvent.JoinDeclined))
    }

    @Test
    fun uneAnnonceDAchatSAnnonceAvecLAcheteurEtLeProduit() {
        val purchase = ChatMessage.Purchase(
            id = "m_1",
            author = Participant("twitch:u_88", "twitch", "Noa"),
            role = Role.Viewer,
            at = Instant.parse("2026-11-06T10:00:00Z"),
            product = PurchasedProduct("p_1", "Baskets Runner X", 8999, "EUR"),
        )

        val toast = toastOf(LiveEvent.PurchaseAnnounced(purchase))!!

        assertEquals("🛍", toast.symbol)
        assertTrue(toast.text, toast.text.startsWith("Noa a acheté Baskets Runner X · "))
    }

    @Test
    fun lesReactionsNeSAnnoncentPasEnToast() {
        assertNull(toastOf(LiveEvent.ReactionsReceived(mapOf("❤️" to 3))))
    }
}
