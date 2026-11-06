import LiveSDK

/// Grille portrait de la scène : 1 plein écran, 2 empilées, 2 × 2, puis 2 × 3.
/// La tuile 0 (l'Hôte) est en haut à gauche, les suivantes remplissent ligne par ligne.
public struct StageMosaic: Sendable, Hashable {
    /// L'Hôte et ses Co-hôtes.
    public static let maxTiles = 1 + LiveSession.maxCohosts

    public struct Position: Sendable, Hashable {
        public let row: Int
        public let column: Int

        public init(row: Int, column: Int) {
            self.row = row
            self.column = column
        }
    }

    public let count: Int

    public init(count: Int) {
        self.count = min(max(count, 1), Self.maxTiles)
    }

    public var columns: Int { count <= 2 ? 1 : 2 }
    public var rows: Int { (count + columns - 1) / columns }

    public func position(of index: Int) -> Position {
        Position(row: index / columns, column: index % columns)
    }
}
