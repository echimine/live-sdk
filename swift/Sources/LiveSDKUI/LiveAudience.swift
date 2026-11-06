import LiveSDK
import SwiftUI

struct AudienceSheet: View {
    let audience: Audience
    let onClose: () -> Void
    @Environment(\.liveTheme) private var theme

    private var apps: [String] {
        audience.byApp.keys.sorted {
            let first = audience.byApp[$0, default: 0]
            let second = audience.byApp[$1, default: 0]
            return first == second ? $0 < $1 : first > second
        }
    }

    var body: some View {
        List {
            Section("\(audience.total.formatted()) Spectateurs") {
                if apps.isEmpty {
                    Text("Aucun Spectateur pour l’instant.")
                }
                ForEach(apps, id: \.self) { app in
                    LabeledContent(app, value: audience.byApp[app, default: 0].formatted())
                }
            }
        }
        .font(theme.font(16))
        .tint(theme.accent)
        .navigationTitle("Audience")
        .toolbar { Button("Fermer", action: onClose) }
    }
}

struct LiveRecapSheet: View {
    let recap: LiveRecap
    let onClose: () -> Void
    @Environment(\.liveTheme) private var theme

    var body: some View {
        List {
            LabeledContent("Achats", value: recap.purchases.formatted())
            LabeledContent("Réactions", value: recap.reactions.formatted())
            LabeledContent("Audience maximale", value: recap.peakAudience.formatted())
        }
        .font(theme.font(16))
        .tint(theme.accent)
        .navigationTitle("Live terminé")
        .toolbar { Button("Fermer", action: onClose) }
    }
}
