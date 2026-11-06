package fr.echimine.live.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/** Disposition portrait de la mosaïque, de 1 à 6 personnes à l'écran. */
class MosaicGridTest {
    @Test
    fun uneSeulePersonneEstEnPleinEcran() {
        assertEquals(MosaicGrid(columns = 1, rows = 1), mosaicGrid(1))
    }

    @Test
    fun deuxPersonnesSontEmpilees() {
        assertEquals(MosaicGrid(columns = 1, rows = 2), mosaicGrid(2))
    }

    @Test
    fun troisOuQuatrePersonnesFormentUneGrilleDeuxSurDeux() {
        assertEquals(MosaicGrid(columns = 2, rows = 2), mosaicGrid(3))
        assertEquals(MosaicGrid(columns = 2, rows = 2), mosaicGrid(4))
    }

    @Test
    fun cinqOuSixPersonnesFormentDeuxColonnesSurTroisLignes() {
        assertEquals(MosaicGrid(columns = 2, rows = 3), mosaicGrid(5))
        assertEquals(MosaicGrid(columns = 2, rows = 3), mosaicGrid(6))
    }
}
