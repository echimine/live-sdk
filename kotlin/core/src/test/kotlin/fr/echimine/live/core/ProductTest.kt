@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package fr.echimine.live.core

import kotlinx.coroutines.async
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Seam 3 : Produit épinglé et Achat, via l'API publique du cœur sur faux transport. */
class ProductTest {
    private val transport = FakeTransport()
    private var tokens = 0

    /** Réductions demandées : octets d'origine et plus grand côté autorisé. */
    private val reductions = mutableListOf<Pair<ByteArray, Int>>()
    private val reducer = ImageReducer { bytes, maxSide ->
        reductions += bytes to maxSide
        if (bytes.contentEquals(UNREADABLE)) null else REDUCED
    }

    private fun TestScope.configure(): LiveClient = LiveSdk.configure(
        serverUrl = "https://live.example",
        tokenProvider = { "jeton-${++tokens}" },
        transport = transport,
        dispatcher = StandardTestDispatcher(testScheduler),
        timeSource = testScheduler.timeSource,
        imageReducer = reducer,
    )

    private suspend fun TestScope.connectedLive(
        client: LiveClient,
        snapshot: String = "ws/server/snapshot.host.json",
    ): Live {
        val live = client.openLive("lv_8f3k2m")
        runCurrent()
        transport.socket.push(fixture(snapshot))
        runCurrent()
        return live
    }

    private fun ack(type: String) {
        val ref = transport.socket.lastSent(type)["ref"]!!.jsonPrimitive.content
        transport.socket.push("""{"type":"ack","ref":"$ref"}""")
    }

    @Test
    fun epinglerAvecUneImageEnUrlLaTransmetTelleQuelle() = runTest {
        val client = configure()
        val live = connectedLive(client)

        val result = async {
            live.pinProduct(
                "Baskets Runner X",
                8999,
                "EUR",
                ProductImage.Url("https://live.echimine.fr/v1/images/img_5d1c9a.webp"),
            )
        }
        runCurrent()
        val sent = transport.socket.lastSent("pinProduct")
        assertEquals("Baskets Runner X", sent["name"]!!.jsonPrimitive.content)
        assertEquals("8999", sent["price"]!!.jsonPrimitive.content)
        assertEquals("EUR", sent["currency"]!!.jsonPrimitive.content)
        assertEquals("https://live.echimine.fr/v1/images/img_5d1c9a.webp", sent["imageUrl"]!!.jsonPrimitive.content)
        assertEquals(0, transport.requests.count { it.url.endsWith("/v1/images") })
        ack("pinProduct")
        runCurrent()

        assertEquals(LiveResult.Success(Unit), result.await())
        client.close()
    }

    @Test
    fun epinglerAvecUnePhotoLaReduitPuisLEnvoieAuServeurCommun() = runTest {
        transport.http = { request ->
            if (request.url.endsWith("/v1/images")) HttpResponse(201, emptyMap(), fixture("http/images.upload.response.json"))
            else HttpResponse(200, emptyMap(), fixture("config.json"))
        }
        val client = configure()
        val live = connectedLive(client)
        val photo = byteArrayOf(1, 2, 3)

        val result = async { live.pinProduct("Baskets Runner X", 8999, "EUR", ProductImage.Data(photo)) }
        runCurrent()

        val (original, maxSide) = reductions.single()
        assertTrue(original.contentEquals(photo))
        assertEquals(1024, maxSide)
        val upload = transport.requests.single { it.url.endsWith("/v1/images") }
        assertEquals("POST", upload.method)
        assertEquals("https://live.example/v1/images", upload.url)
        assertTrue(upload.headers["Authorization"]!!.startsWith("Bearer jeton-"))
        assertEquals("image/jpeg", upload.headers["Content-Type"])
        assertTrue(upload.bytes!!.contentEquals(REDUCED.bytes))
        val sent = transport.socket.lastSent("pinProduct")
        assertEquals("https://live.echimine.fr/v1/images/img_5d1c9a.webp", sent["imageUrl"]!!.jsonPrimitive.content)
        ack("pinProduct")
        runCurrent()

        assertEquals(LiveResult.Success(Unit), result.await())
        client.close()
    }

    @Test
    fun unePhotoIllisibleOuRefuseeNEpinglePasLeProduit() = runTest {
        transport.http = { request ->
            if (request.url.endsWith("/v1/images")) {
                HttpResponse(413, emptyMap(), """{"error":{"code":"payload_too_large","message":"Image trop lourde."}}""")
            } else {
                HttpResponse(200, emptyMap(), fixture("config.json"))
            }
        }
        val client = configure()
        val live = connectedLive(client)

        val unreadable = async { live.pinProduct("Baskets", 8999, "EUR", ProductImage.Data(UNREADABLE)) }
        runCurrent()
        assertEquals(LiveErrorCode.InvalidImage, (unreadable.await() as LiveResult.Failure).error.code)
        assertEquals(0, transport.requests.count { it.url.endsWith("/v1/images") })

        val tooLarge = async { live.pinProduct("Baskets", 8999, "EUR", ProductImage.Data(byteArrayOf(1))) }
        runCurrent()
        assertEquals(
            LiveResult.Failure(LiveError(LiveErrorCode.PayloadTooLarge, "Image trop lourde.")),
            tooLarge.await(),
        )
        assertTrue(transport.socket.sent.none { it["type"]!!.jsonPrimitive.content == "pinProduct" })
        client.close()
    }

    /** Config commune dont les images sont bornées à [maxBytes] octets et aux [formats] donnés. */
    private fun imagesConfig(maxBytes: Long, formats: List<String>): String =
        """{"reactions":["❤️","😂","😮","👏"],"chat":{"maxLength":300},"images":{"maxBytes":$maxBytes,"formats":[${formats.joinToString { "\"$it\"" }}]},"product":{"nameMaxLength":80}}"""

    @Test
    fun unePhotoAuDelaDeLaConfigEstRefuseeSansAppelReseau() = runTest {
        transport.http = { request ->
            if (request.url.endsWith("/v1/config")) HttpResponse(200, emptyMap(), imagesConfig(maxBytes = 1, formats = listOf("image/jpeg")))
            else HttpResponse(201, emptyMap(), fixture("http/images.upload.response.json"))
        }
        val client = configure()
        val live = connectedLive(client)
        assertEquals(1L, client.config.value.imagesMaxBytes)

        val tooLarge = async { live.pinProduct("Baskets", 8999, "EUR", ProductImage.Data(byteArrayOf(1))) }
        runCurrent()

        assertEquals(LiveErrorCode.PayloadTooLarge, (tooLarge.await() as LiveResult.Failure).error.code)
        assertEquals(1, reductions.size) // l'image est bien réduite d'abord (2 octets, au-delà de 1)
        assertEquals(0, transport.requests.count { it.url.endsWith("/v1/images") })
        assertTrue(transport.socket.sent.none { it["type"]!!.jsonPrimitive.content == "pinProduct" })
        client.close()
    }

    @Test
    fun unFormatHorsDeLaConfigEstRefuseSansAppelReseau() = runTest {
        transport.http = { request ->
            if (request.url.endsWith("/v1/config")) HttpResponse(200, emptyMap(), imagesConfig(maxBytes = 10_485_760, formats = listOf("image/png")))
            else HttpResponse(201, emptyMap(), fixture("http/images.upload.response.json"))
        }
        val client = configure()
        val live = connectedLive(client)
        assertEquals(listOf("image/png"), client.config.value.imageFormats)

        val unsupported = async { live.pinProduct("Baskets", 8999, "EUR", ProductImage.Data(byteArrayOf(1))) }
        runCurrent()

        assertEquals(LiveErrorCode.UnsupportedMediaType, (unsupported.await() as LiveResult.Failure).error.code)
        assertEquals(0, transport.requests.count { it.url.endsWith("/v1/images") })
        assertTrue(transport.socket.sent.none { it["type"]!!.jsonPrimitive.content == "pinProduct" })
        client.close()
    }

    @Test
    fun unProduitInvalideEstRefuseSansRienEnvoyer() = runTest {
        val client = configure()
        val live = connectedLive(client)

        val invalid = listOf(
            Triple("", 8999, "EUR"),
            Triple("   ", 8999, "EUR"),
            Triple("x".repeat(81), 8999, "EUR"),
            Triple("Baskets", -1, "EUR"),
            Triple("Baskets", 1_000_001, "EUR"),
            Triple("Baskets", 8999, "eur"),
            Triple("Baskets", 8999, "EURO"),
        )
        invalid.forEach { (name, price, currency) ->
            val result = live.pinProduct(name, price, currency, ProductImage.Data(byteArrayOf(1)))
            assertEquals("$name/$price/$currency", LiveErrorCode.InvalidProduct, (result as LiveResult.Failure).error.code)
        }
        // Comme le serveur commun : la longueur du nom se compte en unités UTF-16 (un emoji en vaut 2).
        val emojiName = live.pinProduct("👟".repeat(41), 8999, "EUR")
        assertEquals(LiveErrorCode.InvalidProduct, (emojiName as LiveResult.Failure).error.code)
        val httpImage = live.pinProduct("Baskets", 8999, "EUR", ProductImage.Url("http://cdn.example/a.jpg"))
        assertEquals(LiveErrorCode.InvalidProduct, (httpImage as LiveResult.Failure).error.code)
        assertEquals(emptyList<Pair<ByteArray, Int>>(), reductions)
        assertTrue(transport.socket.sent.none { it["type"]!!.jsonPrimitive.content == "pinProduct" })

        // Les bornes sont admises, et le nom est envoyé sans ses espaces autour.
        val edge = async { live.pinProduct("  ${"x".repeat(80)}  ", 1_000_000, "JPY") }
        runCurrent()
        assertEquals("x".repeat(80), transport.socket.lastSent("pinProduct")["name"]!!.jsonPrimitive.content)
        ack("pinProduct")
        runCurrent()
        assertEquals(LiveResult.Success(Unit), edge.await())
        client.close()
    }

    @Test
    fun acheterUnProduitQuiAChangeRenvoieProductChanged() = runTest {
        val client = configure()
        val live = connectedLive(client, "ws/server/snapshot.viewer.json")
        val pinned = live.state.value.live!!.pinnedProduct!!

        val purchase = async { live.purchase(pinned.id) }
        runCurrent()
        val sent = transport.socket.lastSent("purchase")
        assertEquals("prd_7a21", sent["productId"]!!.jsonPrimitive.content)
        transport.socket.push(
            """{"type":"error","ref":"${sent["ref"]!!.jsonPrimitive.content}","code":"product_changed","message":"Le produit a changé."}""",
        )
        transport.socket.push(
            """{"type":"productPinned","product":{"id":"prd_9b02","name":"Casquette","price":2500,"currency":"EUR"}}""",
        )
        runCurrent()

        assertEquals(LiveErrorCode.ProductChanged, (purchase.await() as LiveResult.Failure).error.code)
        assertEquals(Product("prd_9b02", "Casquette", 2500, "EUR"), live.state.value.live!!.pinnedProduct)

        val unpin = async { live.unpinProduct() }
        runCurrent()
        ack("unpinProduct")
        transport.socket.push(fixture("ws/server/productUnpinned.json"))
        runCurrent()
        assertEquals(LiveResult.Success(Unit), unpin.await())
        assertNull(live.state.value.live!!.pinnedProduct)
        client.close()
    }

    private companion object {
        val UNREADABLE = byteArrayOf(0)
        val REDUCED = ReducedImage(byteArrayOf(9, 9), "image/jpeg")
    }
}
