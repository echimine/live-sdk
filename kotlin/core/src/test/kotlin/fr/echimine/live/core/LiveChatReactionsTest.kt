@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package fr.echimine.live.core

import kotlinx.coroutines.async
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Duration.Companion.milliseconds

/** Seam 3 : commandes, chat (verrou compris) et Réactions, via l'API publique du cœur. */
class LiveChatReactionsTest : LiveTestBase() {
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
        assertNull(live.state.value.chatUnlockAt)
        assertNull(live.state.value.chatLockRemaining)

        val first = async { live.sendMessage("un") }
        runCurrent()
        val ref = transport.socket.lastSent("sendMessage")["ref"]!!.jsonPrimitive.content
        transport.socket.push("""{"type":"error","ref":"$ref","code":"rate_limited","message":"Doucement…","retryAfterMs":4200}""")
        runCurrent()
        assertEquals(LiveErrorCode.RateLimited, (first.await() as LiveResult.Failure).error.code)
        assertTrue(live.state.value.chatLocked)
        // La fin du verrou est exposée : les écrans affichent le décompte.
        assertEquals(4200.milliseconds, live.state.value.chatLockRemaining)

        advanceTimeBy(1_000)
        assertEquals(3200.milliseconds, live.state.value.chatLockRemaining)
        val locked = live.sendMessage("deux") as LiveResult.Failure
        assertEquals(LiveErrorCode.RateLimited, locked.error.code)
        assertEquals(3_200L, locked.error.retryAfterMs)
        assertEquals(1, transport.socket.sent.count { it["type"]!!.jsonPrimitive.content == "sendMessage" })

        advanceTimeBy(3_199)
        assertTrue(live.state.value.chatLocked)
        assertEquals(1.milliseconds, live.state.value.chatLockRemaining)
        advanceTimeBy(2)
        assertFalse(live.state.value.chatLocked)
        assertNull(live.state.value.chatUnlockAt)
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
}
