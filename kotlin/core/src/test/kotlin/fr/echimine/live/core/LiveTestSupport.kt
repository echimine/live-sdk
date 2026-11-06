@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package fr.echimine.live.core

import kotlinx.coroutines.async
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.serialization.json.jsonPrimitive

/**
 * Socle des tests du cœur (Seam 3) : un faux transport, un client à temps virtuel et les gestes
 * courants (ouvrir un Live, répondre à une commande, changer un rôle).
 */
abstract class LiveTestBase {
    protected val transport = FakeTransport()
    private var tokens = 0

    protected fun TestScope.configure(): LiveClient = LiveSdk.configure(
        serverUrl = "https://live.example",
        tokenProvider = { "jeton-${++tokens}" },
        transport = transport,
        dispatcher = StandardTestDispatcher(testScheduler),
        timeSource = testScheduler.timeSource,
    )

    /** Ouvre un Live et lui fait recevoir [snapshot]. */
    protected suspend fun TestScope.connectedLive(
        client: LiveClient,
        snapshot: String = "ws/server/snapshot.viewer.json",
    ): Live {
        val live = client.openLive("lv_8f3k2m")
        runCurrent()
        transport.socket.push(fixture(snapshot))
        runCurrent()
        return live
    }

    protected fun Live.details(): LiveDetails = state.value.live!!

    /** Envoie la commande [type] lancée par [send], y répond par [reply] (à partir de son `ref`) et rend son résultat. */
    protected suspend fun TestScope.answered(
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

    protected suspend fun TestScope.acked(type: String, send: suspend () -> LiveResult<Unit>): LiveResult<Unit> =
        answered(type, { ref -> """{"type":"ack","ref":"$ref"}""" }, send)

    /** Le serveur annonce que [participant] (JSON) passe au rôle [role]. */
    protected fun TestScope.pushRoleChanged(participant: String, role: String) {
        transport.socket.push("""{"type":"roleChanged","participant":$participant,"role":"$role"}""")
        runCurrent()
    }

    protected companion object {
        /** Noa, en Demande de montée dans `snapshot.host.json`. */
        const val NOA = """{"id":"twitch:u_88","app":"twitch","name":"Noa"}"""

        /** Sam, Co-hôte dans les fixtures `snapshot.*`. */
        const val SAM = """{"id":"snapcore:u_310","app":"snapcore","name":"Sam"}"""
    }
}
