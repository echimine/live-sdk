@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package fr.echimine.live.core

import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Seam 3 : événements du Live, Audience, Demandes de montée et Co-hôtes, via l'API publique du cœur. */
class LiveStageTest : LiveTestBase() {
    @Test
    fun lesEvenementsMettentLEtatAJour() = runTest {
        val client = configure()
        val live = connectedLive(client, "ws/server/snapshot.host.json")
        val events = mutableListOf<LiveEvent>()
        val collecting = backgroundScope.launch(StandardTestDispatcher(testScheduler)) { live.events.toList(events) }
        runCurrent()

        listOf(
            "audience", "chatMessage.purchase", "reactions", "hostDisconnected", "productUnpinned",
            "messageDeleted", "joinRequestCancelled", "moderationChanged",
        ).forEach { transport.socket.push(fixture("ws/server/$it.json")) }
        runCurrent()

        val details = live.details()
        assertEquals(38, details.audience.total)
        assertEquals(10, details.audience.byApp["twitch"])
        assertEquals(1311, details.reactionsTotal)
        assertFalse(details.hostConnected)
        assertNull(details.pinnedProduct)
        assertEquals(listOf("msg_0194"), details.messages.map { it.id }) // msg_0193 supprimé, msg_0194 non dupliqué
        assertTrue(details.joinRequests.isEmpty())
        assertEquals(listOf("Troll"), details.moderation!!.banned.map { it.name })
        assertEquals(
            listOf(
                LiveEvent.PurchaseAnnounced(details.messages.single() as ChatMessage.Purchase),
                LiveEvent.ReactionsReceived(mapOf("❤️" to 18, "🔥" to 7, "😂" to 2)),
            ),
            events,
        )

        transport.socket.push(fixture("ws/server/hostReconnected.json"))
        transport.socket.push(fixture("ws/server/productPinned.json"))
        transport.socket.push(fixture("ws/server/joinRequested.json"))
        runCurrent()
        assertTrue(live.details().hostConnected)
        assertEquals("prd_7a21", live.details().pinnedProduct!!.id)
        assertEquals(listOf("Noa"), live.details().joinRequests.map { it.name })
        collecting.cancel()
        client.close()
    }

    @Test
    fun lAudienceSeDetailleParAppDOrigineDeLaPlusPresenteALaMoinsPresente() = runTest {
        val client = configure()
        val live = connectedLive(client)
        transport.socket.push(
            """{"type":"audience","total":9,"byApp":{"strava":1,"twitch":4,"instagram":2,"tiktok":2}}""",
        )
        runCurrent()

        assertEquals(
            listOf("twitch" to 4, "instagram" to 2, "tiktok" to 2, "strava" to 1),
            live.details().audience.ranked,
        )
        client.close()
    }

    @Test
    fun unSpectateurQuiMonteDevientCoHoteEtAnimateur() = runTest {
        val client = configure()
        val live = connectedLive(client)
        pushRoleChanged(NOA, "cohost")

        assertEquals(Role.Cohost, live.details().role)
        assertTrue(live.details().role.isAnimator)
        assertEquals(listOf("Sam", "Noa"), live.details().cohosts.map { it.name })
        client.close()
    }

    @Test
    fun laDemandeDeMonteeResteEnAttenteJusquaSonAnnulation() = runTest {
        val client = configure()
        val live = connectedLive(client)
        assertFalse(live.details().requestedToJoin)

        assertEquals(LiveResult.Success(Unit), acked("requestToJoin") { live.requestToJoin() })
        assertTrue(live.details().requestedToJoin)

        assertEquals(LiveResult.Success(Unit), acked("cancelJoinRequest") { live.cancelJoinRequest() })
        assertFalse(live.details().requestedToJoin)
        client.close()
    }

    @Test
    fun unRefusDeLHoteEffaceLaDemandeEtLAnnonce() = runTest {
        val client = configure()
        val live = connectedLive(client)
        val events = mutableListOf<LiveEvent>()
        backgroundScope.launch(StandardTestDispatcher(testScheduler)) { live.events.toList(events) }
        acked("requestToJoin") { live.requestToJoin() }

        transport.socket.push(fixture("ws/server/joinDeclined.json"))
        runCurrent()

        assertFalse(live.details().requestedToJoin)
        assertEquals(listOf<LiveEvent>(LiveEvent.JoinDeclined), events)
        client.close()
    }

    @Test
    fun laDemandeDeMonteeDisparaitALaMonteeEtALaReconnexion() = runTest {
        val client = configure()
        val live = connectedLive(client)
        acked("requestToJoin") { live.requestToJoin() }
        pushRoleChanged(NOA, "cohost")
        assertFalse(live.details().requestedToJoin)

        pushRoleChanged(NOA, "viewer")
        acked("requestToJoin") { live.requestToJoin() }
        assertTrue(live.details().requestedToJoin)

        // Le serveur oublie la demande quand le socket se ferme : le `snapshot` suivant n'en a plus.
        transport.socket.drop()
        advanceTimeBy(1_001)
        runCurrent()
        transport.socket.push(fixture("ws/server/snapshot.viewer.json"))
        runCurrent()
        assertFalse(live.details().requestedToJoin)
        client.close()
    }

    @Test
    fun laMosaiquePlaceLHoteEnPremierPuisLesCoHotesParOrdreDeMontee() = runTest {
        val client = configure()
        val live = connectedLive(client, "ws/server/snapshot.host.json")
        acked("acceptJoin") { live.acceptJoin("twitch:u_88") }
        pushRoleChanged(NOA, "cohost")
        assertEquals(listOf("Léa", "Sam", "Noa"), live.details().stage.map { it.name })
        assertTrue(live.details().joinRequests.isEmpty())

        // Sam redescend : Noa prend sa place, l'ordre de montée est gardé.
        pushRoleChanged(SAM, "viewer")
        assertEquals(listOf("Léa", "Noa"), live.details().stage.map { it.name })
        client.close()
    }

    @Test
    fun uneDemandeRefuseeQuitteLaListeDeLHote() = runTest {
        val client = configure()
        val live = connectedLive(client, "ws/server/snapshot.host.json")
        assertEquals(listOf("Noa"), live.details().joinRequests.map { it.name })

        // Le serveur ne prévient que le Spectateur refusé : l'Hôte retire la demande à l'`ack`.
        assertEquals(LiveResult.Success(Unit), acked("declineJoin") { live.declineJoin("twitch:u_88") })
        assertTrue(live.details().joinRequests.isEmpty())
        client.close()
    }

    @Test
    fun auDelaDeCinqCoHotesLAcceptationEchoueAvecCohostLimit() = runTest {
        val client = configure()
        val live = connectedLive(client, "ws/server/snapshot.host.json")

        val result = answered(
            "acceptJoin",
            { ref -> """{"type":"error","ref":"$ref","code":"cohost_limit","message":"Déjà 5 Co-hôtes à l'écran."}""" },
        ) { live.acceptJoin("twitch:u_88") }

        assertEquals(LiveErrorCode.CohostLimit, (result as LiveResult.Failure).error.code)
        assertEquals(listOf("Noa"), live.details().joinRequests.map { it.name })
        client.close()
    }
}
