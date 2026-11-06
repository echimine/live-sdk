import os

/// Journaux natifs (Console, `log stream --subsystem fr.echimine.live`), sans télémétrie.
/// Jamais de jeton, d'URL portant un jeton, ni de texte du chat : des codes, des types et des compteurs seulement.
enum LiveLog {
    static let subsystem = "fr.echimine.live"
    static let session = Logger(subsystem: subsystem, category: "session")
    static let media = Logger(subsystem: subsystem, category: "media")
    static let http = Logger(subsystem: subsystem, category: "http")
}
