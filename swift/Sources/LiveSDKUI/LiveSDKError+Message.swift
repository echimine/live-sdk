import LiveSDK

/// Un seul libellé par code d'erreur, pour tous les écrans.
extension LiveCommandError {
    /// Déjà 5 Co-hôtes : aussi affiché en pied de la liste des Demandes de montée.
    static let stageFullMessage = "Déjà \(LiveSession.maxCohosts) Co-hôtes à l’écran : retirez-en un pour accepter."

    var displayMessage: String {
        switch code {
        case .cohostLimit: Self.stageFullMessage
        case .rateLimited: "Doucement…"
        case .productChanged: "Le produit a changé entre-temps."
        case .notFound: "Ce n’est plus d’actualité."
        case .disconnected, .network: "Connexion perdue. Réessayez."
        default: message.isEmpty ? "L’action a échoué. Réessayez." : message
        }
    }
}

extension LiveSDKError {
    var displayMessage: String {
        switch self {
        case .notConfigured: "Le SDK Live n'est pas configuré."
        case .tokenUnavailable: "Impossible d'obtenir votre identité auprès de l'app."
        case .network: "Serveur injoignable. Vérifiez votre connexion."
        case .server(_, let message): message.isEmpty ? "Le serveur a refusé la demande." : message
        }
    }
}

extension Error {
    var displayMessage: String {
        switch self {
        case let error as LiveCommandError: error.displayMessage
        case let error as LiveSDKError: error.displayMessage
        default: "Une erreur est survenue. Réessayez."
        }
    }
}
