import LiveSDK
import SwiftUI

public struct LiveScreen: View {
    private enum Source {
        case session(LiveSession)
        case id(String, LiveSDK)
    }

    private let source: Source
    private let onClose: () -> Void
    @State private var opened: LiveSession?
    @State private var openError: String?

    public init(session: LiveSession, onClose: @escaping () -> Void) {
        source = .session(session)
        self.onClose = onClose
    }

    public init(liveId: String, sdk: LiveSDK = .shared, onClose: @escaping () -> Void) {
        source = .id(liveId, sdk)
        self.onClose = onClose
    }

    public var body: some View {
        Group {
            if let session = currentSession {
                LiveStage(session: session, onClose: onClose)
            } else {
                ZStack {
                    Color.black.ignoresSafeArea()
                    if let openError {
                        Text(openError).foregroundStyle(.white)
                    } else {
                        ProgressView().tint(.white)
                    }
                    VStack {
                        HStack {
                            Spacer()
                            CloseButton(label: "Fermer", action: onClose)
                        }
                        Spacer()
                    }
                    .padding(16)
                }
            }
        }
        .task {
            guard case .id(let id, let sdk) = source, opened == nil else { return }
            do {
                let session = try await sdk.openLive(id: id)
                if Task.isCancelled {
                    await session.leave()
                } else {
                    opened = session
                }
            } catch {
                openError = error.displayMessage
            }
        }
        .onDisappear {
            guard let session = currentSession else { return }
            Task { await session.leave() }
        }
    }

    private var currentSession: LiveSession? {
        switch source {
        case .session(let session): session
        case .id: opened
        }
    }
}

private struct LiveStage: View {
    let session: LiveSession
    let onClose: () -> Void
    @Environment(\.liveTheme) private var theme

    var body: some View {
        ZStack {
            HostVideo(session: session).ignoresSafeArea()
            if let notice = statusNotice {
                Text(notice)
                    .font(theme.font(15, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: theme.cornerRadius))
            }
            VStack {
                topBar
                Spacer()
                dock
            }
            .padding(16)
        }
        .background(Color.black)
        .font(theme.font(16))
        .tint(theme.accent)
    }

    private var topBar: some View {
        HStack {
            Text(theme.label)
                .font(theme.font(14, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(theme.accent, in: RoundedRectangle(cornerRadius: theme.cornerRadius))
            Spacer()
            CloseButton(label: "Quitter le Live") {
                Task {
                    await session.leave()
                    onClose()
                }
            }
        }
    }

    private var dock: some View {
        HStack(spacing: 12) {}
            .frame(maxWidth: .infinity, minHeight: 48)
    }

    private var statusNotice: String? {
        switch session.status {
        case .connecting: "Connexion au Live…"
        case .reconnecting: "Reconnexion…"
        case .connected: nil
        case .ended: "Le Live est terminé."
        case .replaced: "Ce Live est ouvert sur un autre appareil."
        case .banned: "Vous avez été exclu de ce Live."
        case .failed(.liveNotFound): "Ce Live n'existe pas ou est terminé."
        case .failed: "Impossible de rejoindre ce Live."
        case .left: nil
        }
    }
}
