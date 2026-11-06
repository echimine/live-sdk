@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package fr.echimine.live.core

import kotlinx.coroutines.async
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Seam 3 : le cœur Kotlin, piloté par son API publique sur un faux transport. */
class LiveTest {
    private val transport = FakeTransport()
    private var tokens = 0

    private fun TestScope.configure(): LiveClient = LiveSdk.configure(
        serverUrl = "https://live.example",
        tokenProvider = { "jeton-${++tokens}" },
        transport = transport,
        dispatcher = StandardTestDispatcher(testScheduler),
        timeSource = testScheduler.timeSource,
    )

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

    /** Ouvre un Live et lui fait recevoir [snapshot]. */
    private suspend fun TestScope.connectedLive(
        client: LiveClient,
        snapshot: String = "ws/server/snapshot.viewer.json",
    ): Live {
        val live = client.openLive("lv_8f3k2m")
        runCurrent()
        transport.socket.push(fixture(snapshot))
        runCurrent()
        return live
    }

    private fun Live.details(): LiveDetails = state.value.live!!

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

    /** Envoie la commande [type] lancée par [send], y répond par [reply] (à partir de son `ref`) et rend son résultat. */
    private suspend fun TestScope.answered(
        type: String,
        reply: (ref: String) -> String,
        send: suspend () -> LiveResult<Unit>,
    ): LiveResult<Unit> {
        val result = async { send() }
        runCurrent()
        val ref = transport.socket.lastSent(type)["ref"]!!.jsonPrimitive.content
        transport.socket.push(reply(ref))
        runCurrent()
        return result.await()
    }

    private suspend fun TestScope.acked(type: String, send: suspend () -> LiveResult<Unit>): LiveResult<Unit> =
        answered(type, { ref -> """{"type":"ack","ref":"$ref"}""" }, send)

    /** Le serveur annonce que [participant] (JSON) passe au rôle [role]. */
    private fun TestScope.pushRoleChanged(participant: String, role: String) {
        transport.socket.push("""{"type":"roleChanged","participant":$participant,"role":"$role"}""")
        runCurrent()
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
    fun uneCommandeRenvoieSuccesALAckDeSonRef() = runTest {
        val client = configure()
        val live = connectedLive(client)
        val result = async { live.sendMessage("Elles existent en 42 ?") }
        runCurrent()

        val sent = transport.socket.lastSent("sendMessage")
        assertEquals("Elles existent en 42 ?", sent["text"]!!.jsonPrimitive.content)
        val ref = sent["ref"]!!.jsonPrimitive.content
        transport.socket.push("""{"type":"ack","ref":"$ref"}""")
        runCurrent()

        assertEquals(LiveResult.Success(Unit), result.await())
        client.close()
    }

    @Test
    fun uneCommandeRefuseeRenvoieUneErreurACodeFerme() = runTest {
        val client = configure()
        val live = connectedLive(client)

        val shadowban = async { live.shadowban("instagram:u_5521") }
        val message = async { live.sendMessage("spam") }
        runCurrent()
        val shadowbanRef = transport.socket.lastSent("shadowban")["ref"]!!.jsonPrimitive.content
        val messageRef = transport.socket.lastSent("sendMessage")["ref"]!!.jsonPrimitive.content
        transport.socket.push("""{"type":"error","ref":"$messageRef","code":"rate_limited","message":"Doucement…","retryAfterMs":4200}""")
        transport.socket.push("""{"type":"error","ref":"$shadowbanRef","code":"not_animator","message":"Non."}""")
        runCurrent()

        assertEquals(
            LiveResult.Failure(LiveError(LiveErrorCode.NotAnimator, "Non.")),
            shadowban.await(),
        )
        assertEquals(
            LiveResult.Failure(LiveError(LiveErrorCode.RateLimited, "Doucement…", retryAfterMs = 4200)),
            message.await(),
        )
        client.close()
    }

    @Test
    fun uneCommandeSansReponseOuHorsConnexionEchoue() = runTest {
        val client = configure()
        val live = client.openLive("lv_8f3k2m")
        runCurrent()
        assertEquals(LiveErrorCode.NotConnected, (live.purchase("prd_7a21") as LiveResult.Failure).error.code)

        transport.socket.push(fixture("ws/server/snapshot.viewer.json"))
        runCurrent()
        val unanswered = async { live.purchase("prd_7a21") }
        advanceTimeBy(10_001)
        assertEquals(LiveErrorCode.Timeout, (unanswered.await() as LiveResult.Failure).error.code)

        val cut = async { live.requestToJoin() }
        runCurrent()
        transport.socket.drop()
        runCurrent()
        assertEquals(LiveErrorCode.NotConnected, (cut.await() as LiveResult.Failure).error.code)
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
        transport.socket.push(fixture("ws/server/error.join.json"))
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

    @Test
    fun unMessageVideOuTropLongEstRefuseAvantLEnvoi() = runTest {
        val client = configure()
        val live = connectedLive(client)

        val empty = live.sendMessage("   \n ")
        val tooLong = live.sendMessage("👍🏽".repeat(301)) // 301 caractères visibles, 1204 unités UTF-16
        runCurrent()

        assertEquals(LiveErrorCode.InvalidMessage, (empty as LiveResult.Failure).error.code)
        assertEquals(LiveErrorCode.InvalidMessage, (tooLong as LiveResult.Failure).error.code)
        assertTrue(transport.socket.sent.none { it["type"]!!.jsonPrimitive.content == "sendMessage" })

        val longest = async { live.sendMessage("  " + "👍🏽".repeat(300) + " ") }
        runCurrent()
        assertEquals("👍🏽".repeat(300), transport.socket.lastSent("sendMessage")["text"]!!.jsonPrimitive.content)
        longest.cancel()
        client.close()
    }

    @Test
    fun rateLimitedVerrouilleLeChatLeTempsIndique() = runTest {
        val client = configure()
        val live = connectedLive(client)
        assertFalse(live.state.value.chatLocked)

        val first = async { live.sendMessage("un") }
        runCurrent()
        val ref = transport.socket.lastSent("sendMessage")["ref"]!!.jsonPrimitive.content
        transport.socket.push("""{"type":"error","ref":"$ref","code":"rate_limited","message":"Doucement…","retryAfterMs":4200}""")
        runCurrent()
        assertEquals(LiveErrorCode.RateLimited, (first.await() as LiveResult.Failure).error.code)
        assertTrue(live.state.value.chatLocked)

        advanceTimeBy(1_000)
        val locked = live.sendMessage("deux") as LiveResult.Failure
        assertEquals(LiveErrorCode.RateLimited, locked.error.code)
        assertEquals(3_200L, locked.error.retryAfterMs)
        assertEquals(1, transport.socket.sent.count { it["type"]!!.jsonPrimitive.content == "sendMessage" })

        advanceTimeBy(3_199)
        assertTrue(live.state.value.chatLocked)
        advanceTimeBy(2)
        assertFalse(live.state.value.chatLocked)
        val again = async { live.sendMessage("trois") }
        runCurrent()
        assertEquals("trois", transport.socket.lastSent("sendMessage")["text"]!!.jsonPrimitive.content)
        again.cancel()
        client.close()
    }

    @Test
    fun uneReactionPartSansRef() = runTest {
        val client = configure()
        val live = connectedLive(client)
        live.react("🔥")

        val react = transport.socket.lastSent("react")
        assertEquals("🔥", react["emoji"]!!.jsonPrimitive.content)
        assertFalse(react.containsKey("ref"))
        client.close()
    }

    @Test
    fun saPropreReactionSAnimeToutDeSuiteSansEtreAnimeeDeuxFois() = runTest {
        val client = configure()
        val live = client.openLive("lv_8f3k2m")
        val events = mutableListOf<LiveEvent>()
        backgroundScope.launch(StandardTestDispatcher(testScheduler)) { live.events.toList(events) }
        runCurrent()
        live.react("🔥") // hors connexion : ignorée
        transport.socket.push(fixture("ws/server/snapshot.viewer.json"))
        runCurrent()

        live.react("🍕") // hors du jeu de la config : ignorée
        live.react("🔥")
        runCurrent()
        assertEquals(1, transport.socket.sent.count { it["type"]!!.jsonPrimitive.content == "react" })
        assertEquals(listOf<LiveEvent>(LiveEvent.ReactionsReceived(mapOf("🔥" to 1))), events)

        transport.socket.push(fixture("ws/server/reactions.json")) // ❤️ 18, 🔥 7 (dont la nôtre), 😂 2
        transport.socket.push(fixture("ws/server/reactions.json"))
        runCurrent()
        assertEquals(
            listOf(
                LiveEvent.ReactionsReceived(mapOf("❤️" to 18, "🔥" to 6, "😂" to 2)),
                LiveEvent.ReactionsReceived(mapOf("❤️" to 18, "🔥" to 7, "😂" to 2)),
            ),
            events.drop(1),
        )
        assertEquals(1311, live.details().reactionsTotal)
        client.close()
    }

    @Test
    fun saReactionArriveeDansLaFenetreSuivanteNEstPasAnimeeDeuxFois() = runTest {
        val client = configure()
        val live = connectedLive(client)
        val events = mutableListOf<LiveEvent>()
        backgroundScope.launch(StandardTestDispatcher(testScheduler)) { live.events.toList(events) }
        runCurrent()

        live.react("😂")
        transport.socket.push("""{"type":"reactions","counts":{"❤️":2},"total":2}""") // fenêtre déjà close
        transport.socket.push("""{"type":"reactions","counts":{"😂":1,"❤️":1},"total":4}""") // la nôtre
        transport.socket.push("""{"type":"reactions","counts":{"😂":1},"total":5}""") // celle d'un autre
        runCurrent()

        assertEquals(
            listOf(
                LiveEvent.ReactionsReceived(mapOf("😂" to 1)),
                LiveEvent.ReactionsReceived(mapOf("❤️" to 2)),
                LiveEvent.ReactionsReceived(mapOf("❤️" to 1)),
                LiveEvent.ReactionsReceived(mapOf("😂" to 1)),
            ),
            events,
        )
        client.close()
    }

    @Test
    fun unMessageDuChatDUnGenreInconnuNeBloquePasLeSnapshot() = runTest {
        val client = configure()
        val live = client.openLive("lv_8f3k2m")
        runCurrent()
        val snapshot = fixture("ws/server/snapshot.viewer.json").replace(
            "\"messages\": [",
            """"messages": [{"id":"msg_x","kind":"gift","author":{"id":"a:1","app":"a","name":"A"},"role":"viewer","at":"2026-11-06T18:05:00.000Z"},""",
        )
        transport.socket.push(snapshot)
        runCurrent()

        assertEquals(LiveState.Connection.Connected, live.state.value.connection)
        assertEquals(listOf("msg_0193", "msg_0194"), live.details().messages.map { it.id })
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

/** Noa, en Demande de montée dans `snapshot.host.json`. */
private const val NOA = """{"id":"twitch:u_88","app":"twitch","name":"Noa"}"""

/** Sam, Co-hôte dans les fixtures `snapshot.*`. */
private const val SAM = """{"id":"snapcore:u_310","app":"snapcore","name":"Sam"}"""
