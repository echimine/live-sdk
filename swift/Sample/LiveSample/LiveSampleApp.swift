import LiveSDK
import LiveSDKUI
import SwiftUI

@main
struct LiveSampleApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

private enum SampleSettings {
    static func value(_ key: String) -> String {
        Bundle.main.object(forInfoDictionaryKey: key) as? String ?? ""
    }

    static var serverURL: URL { URL(string: value("LiveServerURL")) ?? URL(string: "http://localhost:3000")! }
    static var appId: String { value("LiveAppId") }
    static var tokenSecret: String { value("LiveTokenSecret") }
}

private enum Screen: Identifiable {
    case launch
    case live(LiveSession)
    case liveId(String)

    var id: String {
        switch self {
        case .launch: "launch"
        case .live(let session): "live-\(session.id)"
        case .liveId(let id): "id-\(id)"
        }
    }
}

private struct RootView: View {
    @AppStorage("pseudo") private var pseudo = ""
    @AppStorage("userId") private var userId = UUID().uuidString
    @State private var configured = false
    @State private var screen: Screen?

    var body: some View {
        Group {
            if configured {
                LiveListScreen(onOpenLive: { screen = .liveId($0) }, onLaunch: { screen = .launch })
            } else {
                PseudoForm(pseudo: $pseudo) { Task { await configure() } }
            }
        }
        .liveTheme(LiveTheme(label: "Crosslive"))
        .productSource(DemoProductSource())
        .task {
            if !pseudo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { await configure() }
        }
        .onOpenURL { url in
            if let id = LiveLink.liveId(from: url.absoluteString) { screen = .liveId(id) }
        }
        .fullScreenCover(item: $screen) { current in
            Group {
                switch current {
                case .launch:
                    LiveLaunchScreen(onLaunched: { screen = .live($0) }, onClose: { screen = nil })
                case .live(let session):
                    LiveScreen(session: session, onClose: { screen = nil })
                case .liveId(let id):
                    LiveScreen(liveId: id, onClose: { screen = nil })
                }
            }
            .liveTheme(LiveTheme(label: "Crosslive"))
        .productSource(DemoProductSource())
        }
    }

    private func configure() async {
        let name = pseudo.trimmingCharacters(in: .whitespacesAndNewlines)
        let appId = SampleSettings.appId
        let secret = SampleSettings.tokenSecret
        let userId = userId
        await LiveSDK.shared.configure(serverURL: SampleSettings.serverURL) {
            DemoParticipantToken.sign(appId: appId, secret: secret, userId: userId, name: name)
        }
        configured = true
    }
}

private struct PseudoForm: View {
    @Binding var pseudo: String
    let onContinue: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("Live Sample").font(.largeTitle.bold())
            Text("App membre de test « demo-ios »").foregroundStyle(.secondary)
            TextField("Votre pseudo", text: $pseudo)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.words)
                .onSubmit(onContinue)
            Button("Continuer", action: onContinue)
                .buttonStyle(.borderedProminent)
                .disabled(pseudo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(24)
    }
}

private struct DemoProductSource: ProductSource {
    func searchProducts(matching query: String) async throws -> [ProductSuggestion] {
        try await Task.sleep(for: .milliseconds(100))
        return [
            ProductSuggestion(id: "shirt", name: "T-shirt Crosslive", priceCents: 1990, currency: "EUR"),
            ProductSuggestion(id: "mug", name: "Mug Crosslive", priceCents: 1250, currency: "EUR")
        ].filter { $0.name.localizedCaseInsensitiveContains(query) }
    }
}
