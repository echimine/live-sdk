import Testing
import LiveSDK
import LiveSDKUI

@Suite("Mosaïque : portrait jusqu'à 6, Hôte en haut à gauche")
struct StageMosaicTests {
    @Test(arguments: [
        (1, 1, 1),  // plein écran
        (2, 1, 2),  // 2 empilées
        (3, 2, 2),
        (4, 2, 2),  // 2 × 2
        (5, 2, 3),
        (6, 2, 3),  // 2 × 3
    ])
    func laGrilleSuitLeNombreDePersonnesALEcran(count: Int, columns: Int, rows: Int) {
        #expect(StageMosaic(count: count).columns == columns)
        #expect(StageMosaic(count: count).rows == rows)
    }

    @Test func lHoteEstEnHautAGaucheEtLesCoHotesSuiventLigneParLigne() {
        let mosaic = StageMosaic(count: 5)

        #expect((0..<5).map { mosaic.position(of: $0) } == [
            .init(row: 0, column: 0), .init(row: 0, column: 1),
            .init(row: 1, column: 0), .init(row: 1, column: 1),
            .init(row: 2, column: 0),
        ])
    }

    @Test func auDelaDeSixLaMosaiqueSArreteASix() {
        #expect(StageMosaic(count: 9).count == 6)
        #expect(StageMosaic(count: 0).count == 1)
    }
}
