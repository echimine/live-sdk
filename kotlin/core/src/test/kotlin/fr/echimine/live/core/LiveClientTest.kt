@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package fr.echimine.live.core

import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.IOException
import java.time.Instant

/** Seam 3 : config, liste et lancement des Lives, via l'API publique sur faux transport. */
class LiveClientTest {
    private val transport = FakeTransport()
    private var tokens = 0

    private fun TestScope.configure(): LiveClient = LiveSdk.configure(
        serverUrl = "https://live.example/",
        tokenProvider = { "jeton-${++tokens}" },
        transport = transport,
        dispatcher = StandardTestDispatcher(testScheduler),
        timeSource = testScheduler.timeSource,
    )

    private fun config(body: String, etag: String = "\"v2\"") = HttpResponse(200, mapOf("etag" to etag), body)

    @Test
    fun laConfigEstChargeeAConfigureAvecUnJetonFrais() = runTest {
        transport.http = { config("""{"reactions":["👍","👎","🔥","❤️"],"chat":{"maxLength":150}}""") }
        val client = configure()
        assertEquals(LiveConfig.Defaults, client.config.value)
        runCurrent()

        val request = transport.configRequests().single()
        assertEquals("GET", request.method)
        assertEquals("https://live.example/v1/config", request.url)
        assertEquals("Bearer jeton-1", request.headers["Authorization"])
        assertNull(request.headers["If-None-Match"])
        assertEquals(listOf("👍", "👎", "🔥", "❤️"), client.config.value.reactions)
        assertEquals("👍", client.config.value.quickReaction)
        assertEquals(150, client.config.value.chatMaxLength)
        assertEquals(LiveConfig.Defaults.imageFormats, client.config.value.imageFormats) // clé absente
        client.close()
    }

    @Test
    fun uneCleInvalideReprendSaValeurParDefaut() = runTest {
        transport.http = {
            config(
                """{"reactions":["👍","👎"],"chat":{"maxLength":"300"},"images":{"maxBytes":-1,"formats":[]},
                   "product":{"nameMaxLength":60}}""",
            )
        }
        val client = configure()
        runCurrent()

        val config = client.config.value
        assertEquals(LiveConfig.Defaults.reactions, config.reactions) // moins de 4 Réactions
        assertEquals(300, config.chatMaxLength) // chaîne au lieu d'un entier
        assertEquals(10_485_760L, config.imagesMaxBytes) // négatif
        assertEquals(listOf("image/jpeg", "image/png", "image/webp"), config.imageFormats) // liste vide
        assertEquals(60, config.productNameMaxLength)
        client.close()
    }

    @Test
    fun uneConfigIllisibleOuInjoignableLaisseLesValeursParDefaut() = runTest {
        transport.http = { config("<html>proxy</html>") }
        val illisible = configure()
        runCurrent()
        assertEquals(LiveConfig.Defaults, illisible.config.value)
        illisible.close()

        transport.http = { throw IOException("hors ligne") }
        val horsLigne = configure()
        runCurrent()
        assertEquals(LiveConfig.Defaults, horsLigne.config.value)
        horsLigne.close()
    }

    @Test
    fun laConfigEstRechargeeAvantDOuvrirUnLiveSeulementApres5Minutes() = runTest {
        transport.http = { config("""{"chat":{"maxLength":100}}""", etag = "\"v1\"") }
        val client = configure()
        runCurrent()

        advanceTimeBy(4 * 60_000)
        client.openLive("lv_1").close()
        assertEquals(1, transport.configRequests().size)

        advanceTimeBy(60_001)
        transport.http = { HttpResponse(304, mapOf("ETag" to "\"v1\"")) }
        client.openLive("lv_1").close()
        val revalidation = transport.configRequests()[1]
        assertEquals("\"v1\"", revalidation.headers["If-None-Match"])
        assertEquals(100, client.config.value.chatMaxLength) // 304 : le cache reste

        client.openLive("lv_1").close()
        assertEquals(2, transport.configRequests().size) // revalidée il y a moins de 5 min

        advanceTimeBy(5 * 60_000 + 1)
        transport.http = { config("""{"chat":{"maxLength":200}}""", etag = "\"v2\"") }
        client.openLive("lv_1").close()
        assertEquals(3, transport.configRequests().size)
        assertEquals(200, client.config.value.chatMaxLength)
        client.close()
    }

    @Test
    fun laConfigEchoueeEstRetenteALOuvertureSuivante() = runTest {
        transport.http = { throw IOException("hors ligne") }
        val client = configure()
        runCurrent()

        transport.http = { config("""{"chat":{"maxLength":120}}""") }
        client.openLive("lv_1").close()
        assertEquals(2, transport.configRequests().size)
        assertEquals(120, client.config.value.chatMaxLength)
        client.close()
    }

    @Test
    fun laListeDesLivesEstDecodee() = runTest {
        val client = configure()
        val result = client.lives() as LiveResult.Success

        assertEquals(listOf("lv_8f3k2m", "lv_2b9q7x"), result.value.map { it.id })
        val first = result.value.first()
        assertEquals("Unboxing des nouvelles baskets", first.title)
        assertEquals("tiktok", first.host.app)
        assertEquals(37, first.audience)
        assertEquals(Instant.parse("2026-11-06T18:02:11Z"), first.startedAt)
        assertNull(result.value[1].title)
        assertNull(result.value[1].host.picture)
        val request = transport.requests.single { it.url == "https://live.example/v1/lives" }
        assertEquals("Bearer jeton-1", request.headers["Authorization"])
        client.close()
    }

    @Test
    fun uneErreurHttpRenvoieSonCodeFerme() = runTest {
        val client = configure()
        transport.http = {
            HttpResponse(429, mapOf("Retry-After" to "12"), fixture("http/error.json"))
        }
        assertEquals(
            LiveResult.Failure(
                LiveError(LiveErrorCode.RateLimited, "Trop de requêtes, réessayez plus tard.", retryAfterMs = 12_000),
            ),
            client.lives(),
        )

        transport.http = { HttpResponse(401, body = """{"error":{"code":"invalid_token","message":"Refusé."}}""") }
        assertEquals(LiveErrorCode.InvalidToken, (client.lives() as LiveResult.Failure).error.code)

        transport.http = { HttpResponse(502, body = "Bad Gateway") }
        assertEquals(LiveErrorCode.Unknown, (client.lives() as LiveResult.Failure).error.code)

        transport.http = { throw IOException("hors ligne") }
        assertEquals(LiveErrorCode.Network, (client.lives() as LiveResult.Failure).error.code)
        client.close()
    }

    @Test
    fun unTokenProviderEnEchecDonneUneErreurDediee() = runTest {
        val client = LiveSdk.configure(
            serverUrl = "https://live.example",
            tokenProvider = { throw IllegalStateException("backend indisponible") },
            transport = transport,
            dispatcher = StandardTestDispatcher(testScheduler),
            timeSource = testScheduler.timeSource,
        )
        assertEquals(LiveErrorCode.TokenUnavailable, (client.lives() as LiveResult.Failure).error.code)
        client.close()
    }

    @Test
    fun lancerUnLiveLeCreePuisLOuvre() = runTest {
        val client = configure()
        val live = (client.startLive("Unboxing des nouvelles baskets") as LiveResult.Success).value
        runCurrent()

        val request = transport.requests.single { it.method == "POST" }
        assertEquals("https://live.example/v1/lives", request.url)
        assertEquals(
            Json.parseToJsonElement("""{"title":"Unboxing des nouvelles baskets"}"""),
            Json.parseToJsonElement(request.body!!),
        )
        assertEquals("lv_8f3k2m", live.id)
        assertEquals("wss://live.example/v1/lives/lv_8f3k2m/ws", transport.connectedUrls.single())

        transport.socket.push(fixture("ws/server/snapshot.host.json"))
        runCurrent()
        assertEquals(Role.Host, live.state.value.live!!.role)
        client.close()
    }

    @Test
    fun relancerAlorsQuUnLiveEstEnCoursRendCeLive() = runTest {
        val client = configure()
        val enCours = fixture("http/lives.create.response.json").replace("lv_8f3k2m", "lv_en_cours")
        transport.http = { request ->
            if (request.method == "POST") HttpResponse(200, emptyMap(), enCours) // 200 : Live déjà en cours
            else HttpResponse(200, emptyMap(), fixture("config.json"))
        }

        val live = (client.startLive("Nouveau titre") as LiveResult.Success).value
        runCurrent()

        assertEquals("lv_en_cours", live.id)
        assertEquals("wss://live.example/v1/lives/lv_en_cours/ws", transport.connectedUrls.single())
        client.close()
    }

    @Test
    fun lancerUnLiveSansTitreNEnvoiePasDeTitre() = runTest {
        val client = configure()
        client.startLive()
        val body = Json.parseToJsonElement(transport.requests.single { it.method == "POST" }.body!!).jsonObject
        assertEquals(emptySet<String>(), body.keys)
        client.close()
    }

    @Test
    fun unLancementRefuseNOuvreRien() = runTest {
        val client = configure()
        transport.http = { HttpResponse(429, body = fixture("http/error.json")) }
        val result = client.startLive("Titre") as LiveResult.Failure
        assertEquals(LiveErrorCode.RateLimited, result.error.code)
        assertEquals(0, transport.connectedUrls.size)
        client.close()
    }

    @Test
    fun lIdentifiantDuLiveEstEncodeDansLUrl() = runTest {
        val client = configure()
        client.openLive("lv 1/2")
        runCurrent()
        assertEquals("wss://live.example/v1/lives/lv%201%2F2/ws", transport.connectedUrls.single())
        val join = transport.socket.sent.single()
        assertEquals("join", join["type"]!!.jsonPrimitive.content)
        client.close()
    }

    @Test
    fun uneConfigIllisibleNEcrasePasLeCache() = runTest {
        transport.http = { config("""{"chat":{"maxLength":100}}""") }
        val client = configure()
        runCurrent()

        advanceTimeBy(5 * 60_000 + 1)
        transport.http = { config("<html>proxy</html>", etag = "\"proxy\"") }
        client.openLive("lv_1").close()
        assertEquals(100, client.config.value.chatMaxLength)

        client.openLive("lv_1").close()
        assertEquals(3, transport.configRequests().size) // réponse illisible : pas de fraîcheur gagnée
        assertEquals("\"v2\"", transport.configRequests()[2].headers["If-None-Match"])
        client.close()
    }
}
