import LiveSDK

extension Error {
    var displayMessage: String {
        guard let error = self as? LiveSDKError else { return "Une erreur est survenue. Réessayez." }
        switch error {
        case .notConfigured: return "Le SDK Live n'est pas configuré."
        case .tokenUnavailable: return "Impossible d'obtenir votre identité auprès de l'app."
        case .network: return "Serveur injoignable. Vérifiez votre connexion."
        case .server(_, let message): return message.isEmpty ? "Le serveur a refusé la demande." : message
        }
    }
}
