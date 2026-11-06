package fr.echimine.live.core

import fr.echimine.live.core.protocol.Wire
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Seam 2 : chaque fixture du contrat se décode dans les types Kotlin écrits à la main,
 * puis se réencode en la même valeur JSON (ordre des clés et mise en forme ignorés).
 */
class ProtocolFixturesTest {
    private val fixtures = File(System.getProperty("live.fixtures") ?: "../../protocol/fixtures")

    private fun fixturesIn(dir: String): List<File> =
        File(fixtures, dir).listFiles { file -> file.extension == "json" }.orEmpty().sortedBy { it.name }

    private fun assertRoundTrip(file: File, roundTrip: (String) -> JsonElement) {
        val original = Json.parseToJsonElement(file.readText())
        assertEquals("${file.parentFile.name}/${file.name}", original, roundTrip(file.readText()))
    }

    @Test
    fun lesMessagesDuServeurSeDecodentPuisSeReencodentALIdentique() {
        val files = fixturesIn("ws/server")
        assertTrue("fixtures introuvables dans $fixtures", files.isNotEmpty())
        files.forEach { assertRoundTrip(it, Wire::roundTripServerMessage) }
    }

    @Test
    fun lesMessagesDuSdkSeDecodentPuisSeReencodentALIdentique() {
        val files = fixturesIn("ws/client")
        assertTrue(files.isNotEmpty())
        files.forEach { assertRoundTrip(it, Wire::roundTripClientMessage) }
    }

    @Test
    fun lesCorpsHttpSeDecodentPuisSeReencodentALIdentique() {
        // Le dossier fait foi : chaque fichier doit avoir son type Kotlin (`roundTripHttp` échoue sinon).
        val files = fixturesIn("http")
        assertTrue("fixtures introuvables dans $fixtures", files.isNotEmpty())
        files.forEach { file -> assertRoundTrip(file) { Wire.roundTripHttp(file.nameWithoutExtension, it) } }
    }

    @Test
    fun laConfigSeDecodePuisSeReencodeALIdentique() {
        assertRoundTrip(File(fixtures, "config.json"), Wire::roundTripConfig)
    }

    @Test
    fun lesValeursParDefautEmbarqueesSontLaCopieDeLaFixture() {
        val fixture = Json.parseToJsonElement(File(fixtures, "config.json").readText())
        assertEquals(fixture, Wire.encodeConfig(LiveConfig.Defaults))
    }
}
