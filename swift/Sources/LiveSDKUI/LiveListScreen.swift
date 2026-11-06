import LiveSDK
import SwiftUI

public struct LiveListScreen: View {
    private let sdk: LiveSDK
    private let onOpenLive: (String) -> Void
    private let onLaunch: (() -> Void)?

    @Environment(\.liveTheme) private var theme
    @State private var lives: [LiveSummary] = []
    @State private var loadError: String?
    @State private var loaded = false
    @State private var link = ""

    public init(sdk: LiveSDK = .shared, onOpenLive: @escaping (String) -> Void, onLaunch: (() -> Void)? = nil) {
        self.sdk = sdk
        self.onOpenLive = onOpenLive
        self.onLaunch = onLaunch
    }

    public var body: some View {
        VStack(spacing: 12) {
            header
            directLink
            content
        }
        .padding(.horizontal, 16)
        .font(theme.font(16))
        .tint(theme.accent)
        .task { await load() }
    }

    private var header: some View {
        HStack {
            Text(theme.label).font(theme.font(28, weight: .bold))
            Spacer()
            if let onLaunch {
                Button("Lancer un Live", action: onLaunch)
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.roundedRectangle(radius: theme.cornerRadius))
            }
        }
        .padding(.top, 8)
    }

    private var directLink: some View {
        HStack {
            TextField("Lien ou identifiant d'un Live", text: $link)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .onSubmit(openLink)
            Button("Ouvrir", action: openLink)
                .disabled(LiveLink.liveId(from: link) == nil)
        }
    }

    @ViewBuilder
    private var content: some View {
        if !loaded {
            ProgressView().frame(maxHeight: .infinity)
        } else if let loadError, lives.isEmpty {
            message(loadError, retry: true)
        } else if lives.isEmpty {
            message("Aucun Live en cours pour l'instant.", retry: true)
        } else {
            List(lives) { live in
                Button { onOpenLive(live.id) } label: { LiveRow(live: live) }
                    .buttonStyle(.plain)
            }
            .listStyle(.plain)
            .refreshable { await load() }
        }
    }

    private func message(_ text: String, retry: Bool) -> some View {
        VStack(spacing: 12) {
            Text(text).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if retry {
                Button("Actualiser") { Task { await load() } }
            }
        }
        .frame(maxHeight: .infinity)
    }

    private func openLink() {
        guard let id = LiveLink.liveId(from: link) else { return }
        onOpenLive(id)
    }

    private func load() async {
        do {
            lives = try await sdk.lives()
            loadError = nil
        } catch {
            loadError = error.displayMessage
        }
        loaded = true
    }
}

private struct LiveRow: View {
    let live: LiveSummary
    @Environment(\.liveTheme) private var theme

    var body: some View {
        HStack(spacing: 12) {
            ParticipantAvatar(participant: live.host, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(live.title ?? "Live de \(live.host.name)")
                    .font(theme.font(16, weight: .semibold))
                    .lineLimit(1)
                Text("\(live.host.name) · \(live.host.app)")
                    .font(theme.font(13))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Label("\(live.audience)", systemImage: "eye")
                .font(theme.font(13, weight: .medium))
                .foregroundStyle(.secondary)
                .accessibilityLabel("\(live.audience) spectateurs")
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}
