@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package fr.echimine.live.core

import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Seam 3 : connexion, `snapshot`, reconnexion et fins du Live, via l'API publique du cœur. */
class LiveConnectionTest : LiveTestBase() {
    @Test
    fun ouvrirUnLiveRejointAvecUnJetonFraisPuisExposeLeSnapshot() = runTest {
        val client = configure()
        val live = client.openLive("lv_8f3k2m")
        runCurrent()

        assertEquals("wss://live.example/v1/lives/lv_8f3k2m/ws", transport.connectedUrls.single())
        val join = transport.socket.sent.single()
        assertEquals("join", join["type"]!!.jsonPrimitive.content)
        assertEquals("jeton-2", join["token"]!!.jsonPrimitive.content) // jeton-1 a servi à la config
        assertEquals(LiveState.Connection.Connecting, live.state.value.connection)

        transport.socket.push(fixture("ws/server/snapshot.viewer.json"))
        runCurrent()

        val state = live.state.value
        assertEquals(LiveState.Connection.Connected, state.connection)
        val details = state.live!!
        assertEquals("Unboxing des nouvelles baskets", details.title)
        assertEquals(Role.Viewer, details.role)
        assertEquals("Léa", details.host.name)
        assertEquals(listOf("Sam"), details.cohosts.map { it.name })
        assertEquals(8999, details.pinnedProduct!!.price)
        assertTrue(details.hostConnected)
        assertEquals(37, details.audience.total)
        client.close()
    }

    @Test
    fun unSnapshotMinimalSuffitSansTitreNiProduitPendantLeDelaiDeGrace() = runTest {
        val client = configure()
        val live = connectedLive(client, "ws/server/snapshot.minimal.json")

        val details = live.details()
        assertEquals(LiveState.Connection.Connected, live.state.value.connection)
        assertNull(details.title)
        assertFalse(details.hostConnected)
        assertNull(details.pinnedProduct)
        assertTrue(details.cohosts.isEmpty())
        assertTrue(details.messages.isEmpty())
        assertTrue(details.joinRequests.isEmpty())
        assertNull(details.moderation)
        assertEquals("Marc", details.host.name)
        client.close()
    }

    @Test
    fun unRoleInconnuDUnServeurPlusRecentNeBloquePasLeSnapshot() = runTest {
        val client = configure()
        val live = client.openLive("lv_8f3k2m")
        runCurrent()
        val original = fixture("ws/server/snapshot.viewer.json")
        val snapshot = original.replace("\"role\": \"viewer\"", "\"role\": \"superstar\"")
        check(snapshot != original) { "la fixture ne porte plus \"role\": \"viewer\"" }
        transport.socket.push(snapshot)
        runCurrent()

        assertEquals(LiveState.Connection.Connected, live.state.value.connection)
        assertEquals(Role.Unknown, live.details().role)
        assertFalse(live.details().role.isAnimator)

        // Un message du chat d'un auteur au rôle inconnu arrive aussi.
        transport.socket.push(
            """{"type":"chatMessage","message":{"id":"msg_x","kind":"text","author":{"id":"a:1","app":"a","name":"A"},"role":"superstar","at":"2026-11-06T18:05:00.000Z","text":"Salut"}}""",
        )
        runCurrent()
        assertEquals(Role.Unknown, live.details().messages.last().role)
        client.close()
    }

    @Test
    fun lesTypesEtChampsInconnusSontIgnores() = runTest {
        val client = configure()
        val live = connectedLive(client)
        transport.socket.push("""{"type":"pollStarted","question":"42 ou 43 ?"}""")
        transport.socket.push("pas du JSON")
        transport.socket.push("""{"type":"audience","total":40,"byApp":{"twitch":40},"trend":"up"}""")
        runCurrent()

        assertEquals(LiveState.Connection.Connected, live.state.value.connection)
        assertEquals(40, live.details().audience.total)
        assertEquals(1, transport.sockets.size)
        client.close()
    }

    @Test
    fun uneConnexionPerdueSeRetablitAvecUnJetonFraisPuisRattrapeParSnapshot() = runTest {
        val client = configure()
        val live = connectedLive(client)
        transport.socket.drop()
        runCurrent()

        val reconnecting = live.state.value.connection as LiveState.Connection.Reconnecting
        assertEquals(1, reconnecting.attempt)
        assertEquals("Noa", live.details().you.name) // l'état reste affiché pendant la reconnexion

        advanceTimeBy(999)
        assertEquals(1, transport.sockets.size)
        advanceTimeBy(2)
        assertEquals(2, transport.sockets.size)
        assertEquals("jeton-3", transport.socket.sent.single()["token"]!!.jsonPrimitive.content)

        transport.socket.push(fixture("ws/server/snapshot.cohost.json"))
        runCurrent()
        assertEquals(LiveState.Connection.Connected, live.state.value.connection)
        assertEquals(Role.Cohost, live.details().role)
        client.close()
    }

    @Test
    fun laReconnexionEspaceSesTentativesJusquA10Secondes() = runTest {
        val client = configure()
        val live = connectedLive(client)
        transport.refuseConnections = 6
        transport.socket.drop()
        runCurrent()

        // Tentatives à +1 s, +2 s, +4 s, +8 s, puis toutes les 10 s.
        val expectedDelays = listOf(1_000L, 2_000L, 4_000L, 8_000L, 10_000L, 10_000L)
        expectedDelays.forEachIndexed { index, delayMs ->
            val before = transport.connectedUrls.size
            advanceTimeBy(delayMs - 1)
            assertEquals("tentative ${index + 1} trop tôt", before, transport.connectedUrls.size)
            advanceTimeBy(1)
            runCurrent()
            assertEquals("tentative ${index + 1} manquante", before + 1, transport.connectedUrls.size)
        }
        assertEquals(LiveErrorCode.Network, (live.state.value.connection as LiveState.Connection.Reconnecting).lastError.code)

        advanceTimeBy(10_000)
        runCurrent()
        transport.socket.push(fixture("ws/server/snapshot.viewer.json"))
        runCurrent()
        assertEquals(LiveState.Connection.Connected, live.state.value.connection)

        // Le compteur repart de zéro après un rattrapage réussi.
        transport.socket.drop()
        runCurrent()
        assertEquals(1, (live.state.value.connection as LiveState.Connection.Reconnecting).attempt)
        client.close()
    }

    @Test
    fun unSocketRemplaceNeSeReconnectePas() = runTest {
        val client = configure()
        val live = connectedLive(client)
        transport.socket.push(fixture("ws/server/replaced.json"))
        runCurrent()
        advanceTimeBy(60_000)

        assertEquals(LiveState.Connection.Replaced, live.state.value.connection)
        assertEquals(1, transport.sockets.size)
        assertTrue(transport.socket.closedByClient)
        client.close()
    }

    @Test
    fun laFinDuLiveEstExposeeAvecLeRecapitulatifDeLHote() = runTest {
        val client = configure()
        val live = connectedLive(client, "ws/server/snapshot.host.json")
        transport.socket.push(fixture("ws/server/liveEnded.host.json"))
        runCurrent()
        advanceTimeBy(60_000)

        assertEquals(
            LiveState.Connection.Ended(LiveState.EndReason.EndedByHost, LiveEndSummary(14, 1284, 52)),
            live.state.value.connection,
        )
        assertEquals(1, transport.sockets.size)
        live.close()
        assertTrue(live.state.value.connection is LiveState.Connection.Ended)
        client.close()
    }

    @Test
    fun unLiveTermineParLeDelaiDeLHoteFinitSansRecapitulatif() = runTest {
        val client = configure()
        val live = connectedLive(client, "ws/server/snapshot.minimal.json")
        transport.socket.push(fixture("ws/server/liveEnded.json"))
        runCurrent()
        advanceTimeBy(60_000)

        assertEquals(
            LiveState.Connection.Ended(LiveState.EndReason.HostTimeout, summary = null),
            live.state.value.connection,
        )
        assertEquals(1, transport.sockets.size)
        assertTrue(transport.socket.closedByClient)
        client.close()
    }

    @Test
    fun unBannissementEstDefinitif() = runTest {
        val client = configure()
        val live = connectedLive(client)
        transport.socket.push(fixture("ws/server/banned.json"))
        runCurrent()
        advanceTimeBy(60_000)

        assertEquals(LiveState.Connection.Banned, live.state.value.connection)
        assertEquals(1, transport.sockets.size)
        client.close()
    }

    @Test
    fun unJoinRefuseEstDefinitifSiLeParticipantEstBanni() = runTest {
        val client = configure()
        val live = client.openLive("lv_8f3k2m")
        runCurrent()
        transport.socket.push(fixture("ws/server/error.banned.json"))
        runCurrent()
        advanceTimeBy(60_000)

        val failed = live.state.value.connection as LiveState.Connection.Failed
        assertEquals(LiveErrorCode.Banned, failed.error.code)
        assertEquals(1, transport.sockets.size)
        client.close()
    }

    @Test
    fun unJetonRefuseAuJoinEstRetenteAvecUnJetonFrais() = runTest {
        val client = configure()
        val live = client.openLive("lv_8f3k2m")
        runCurrent()
        transport.socket.push("""{"type":"error","code":"invalid_token","message":"Jeton expiré."}""")
        runCurrent()
        assertEquals(LiveErrorCode.InvalidToken, (live.state.value.connection as LiveState.Connection.Reconnecting).lastError.code)

        advanceTimeBy(1_001)
        assertEquals(2, transport.sockets.size)
        assertEquals("jeton-3", transport.socket.sent.single()["token"]!!.jsonPrimitive.content)
        client.close()
    }

    @OptIn(InternalLiveSdkApi::class)
    @Test
    fun leSnapshotDonneLAccesMediaDuLive() = runTest {
        val client = configure()
        val live = client.openLive("lv_8f3k2m")
        runCurrent()
        assertNull(live.media.value)

        transport.socket.push(fixture("ws/server/snapshot.viewer.json"))
        runCurrent()

        assertEquals(
            MediaAccess("wss://livekit.echimine.fr", "eyJhbGciOiJIUzI1NiJ9.bGl2ZWtpdC1leGVtcGxl.c2lnbmF0dXJl"),
            live.media.value,
        )
        client.close()
    }
}
