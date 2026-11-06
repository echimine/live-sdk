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
    @Environment(\.productSource) private var productSource
    @State private var productOpen = false
    @State private var chatOpen = false
    @State private var reactionsOpen = false
    @State private var audienceOpen = false
    @State private var recapOpen = false
    @State private var stageOpen = false
    @State private var confirmingEnd = false
    @State private var confirmingLeaveStage = false
    @State private var ending = false
    @State private var commandError: String?
    @State private var stageError: String?

    private var interactive: Bool { session.status == .connected }
    private var recap: LiveRecap? {
        guard case .ended(_, let recap) = session.status, session.role == .host else { return nil }
        return recap
    }

    var body: some View {
        ZStack {
            StageVideo(session: session).ignoresSafeArea()
            ReactionsOverlay(session: session)
            PurchaseToast(session: session)
            if let notice = statusNotice {
                Text(notice)
                    .font(theme.font(15, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: theme.cornerRadius))
            }
            VStack(spacing: 12) {
                topBar
                if interactive, let product = session.pinnedProduct {
                    Button { productOpen = true } label: {
                        Label("\(product.name) · \(PriceText.format(cents: product.price, currency: product.currency))", systemImage: "bag.fill")
                            .padding(10).background(.regularMaterial, in: Capsule())
                    }
                }
                if interactive && session.role != .host {
                    HostPresenceBanner(connected: session.hostConnected)
                }
                Spacer()
                if interactive {
                    RecentMessages(messages: session.messages)
                    dock
                } else if case .ended = session.status, recap == nil {
                    Button("Fermer", action: onClose)
                        .buttonStyle(.borderedProminent)
                }
            }
            .padding(16)
        }
        .sheet(isPresented: Binding(
            get: { chatOpen || reactionsOpen || audienceOpen || recapOpen || productOpen || stageOpen },
            set: { if !$0 { closeSheets() } }
        ), onDismiss: {
            if recap != nil { onClose() }
        }) {
            Group {
                if let recap {
                    NavigationStack { LiveRecapSheet(recap: recap, onClose: closeSheets) }
                        .interactiveDismissDisabled()
                } else if stageOpen {
                    NavigationStack { StageManagementSheet(session: session, onClose: closeSheets) }
                } else if productOpen {
                    NavigationStack { ProductSheet(session: session, source: productSource) }
                } else if audienceOpen {
                    NavigationStack { AudienceSheet(audience: session.audience, onClose: closeSheets) }
                } else if chatOpen {
                    ChatSheet(session: session)
                } else {
                    ReactionsSheet(session: session)
                }
            }
            .presentationDetents([.medium, .large])
            .liveTheme(theme)
        }
        .confirmationDialog("Terminer le Live pour tous les Participants ?", isPresented: $confirmingEnd, titleVisibility: .visible) {
            Button("Terminer le Live", role: .destructive) { Task { await endLive() } }
            Button("Annuler", role: .cancel) {}
        }
        .alert("Impossible de terminer le Live", isPresented: Binding(
            get: { commandError != nil }, set: { if !$0 { commandError = nil } }
        )) {
            Button("OK") { commandError = nil }
        } message: {
            Text(commandError ?? "Réessayez.")
        }
        .confirmationDialog("Redescendre de l’écran ?", isPresented: $confirmingLeaveStage, titleVisibility: .visible) {
            Button("Redescendre", role: .destructive) { Task { await leaveStage() } }
            Button("Annuler", role: .cancel) {}
        } message: {
            Text("Votre caméra et votre micro seront coupés ; vous restez dans le Live.")
        }
        .alert("Montée à l’écran", isPresented: Binding(
            get: { stageError != nil }, set: { if !$0 { stageError = nil } }
        )) {
            Button("OK") { stageError = nil }
        } message: {
            Text(stageError ?? "Réessayez.")
        }
        .onChange(of: session.role) { _, role in
            if role != .host { stageOpen = false }
            if role != .cohost { confirmingLeaveStage = false }
        }
        .onChange(of: session.status, initial: true) { _, _ in
            if !interactive {
                confirmingEnd = false
                confirmingLeaveStage = false
                commandError = nil
                stageError = nil
                stageOpen = false
                // Garder la même présentation lors du passage au récapitulatif.
                recapOpen = recap != nil
                chatOpen = false
                reactionsOpen = false
                audienceOpen = false
                productOpen = false
            }
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
            Button { audienceOpen = true } label: {
                Label(session.audience.total.formatted(), systemImage: "eye")
                    .font(theme.font(14, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(8)
                    .background(.black.opacity(0.45), in: Capsule())
            }
            .accessibilityLabel("Audience : \(session.audience.total.formatted()) Spectateurs")
            .disabled(!interactive)
            CloseButton(label: session.role == .host && interactive ? "Terminer le Live" : "Quitter le Live", action: quit)
                .disabled(ending)
        }
    }

    private var dock: some View {
        HStack(spacing: 12) {
            DockButton(symbol: "💬", label: "Ouvrir le chat") { chatOpen = true }
            DockButton(symbol: "🛍", label: "Produit épinglé") { productOpen = true }
            Spacer()
            if session.role == .host {
                Button("Terminer le Live", role: .destructive) { confirmingEnd = true }
                    .disabled(ending)
            }
            Group {
                switch session.role {
                case .host:
                    BadgedDockButton(symbol: "⚙️", label: "Gestion", badge: session.joinRequests.count) { stageOpen = true }
                case .cohost:
                    Button("Redescendre") { confirmingLeaveStage = true }
                        .buttonStyle(.borderedProminent)
                case .viewer:
                    JoinRequestButton(session: session) { stageError = $0 }
                case .unknown, nil:
                    EmptyView()
                }
                if let quick = session.config.reactions.first {
                    QuickReactionButton(emoji: quick) {
                        session.react(quick)
                    } onLongPress: {
                        reactionsOpen = true
                    }
                }
                DockButton(symbol: "😀", label: "Toutes les Réactions") { reactionsOpen = true }
            }
            .disabled(session.status != .connected)
        }
        .frame(maxWidth: .infinity, minHeight: 48)
    }

    private func closeSheets() {
        productOpen = false
        chatOpen = false
        reactionsOpen = false
        audienceOpen = false
        recapOpen = false
        stageOpen = false
    }

    private func leaveStage() async {
        guard interactive, session.role == .cohost else { return }
        do {
            try await session.send(.leaveStage)
        } catch {
            // Déjà redescendu (retiré par l'Hôte entre-temps) : rien à signaler.
            if interactive && session.role == .cohost {
                stageError = error.message.isEmpty ? "Impossible de redescendre. Réessayez." : error.message
            }
        }
    }

    private func quit() {
        if session.role == .host && interactive {
            confirmingEnd = true
        } else {
            Task {
                await session.leave()
                onClose()
            }
        }
    }

    private func endLive() async {
        guard interactive, !ending else { return }
        ending = true
        defer { ending = false }
        do {
            try await session.send(.endLive)
        } catch {
            if interactive {
                commandError = error.message.isEmpty ? "Le Live n’a pas pu être terminé. Réessayez." : error.message
            }
        }
    }

    private var statusNotice: String? {
        switch session.status {
        case .connecting: "Connexion au Live…"
        case .reconnecting: "Reconnexion…"
        case .connected: nil
        case .ended(let reason, _):
            recap != nil ? nil : (reason == .hostTimeout ? "Le Live est terminé : l’Hôte n’est pas revenu." : "Le Live est terminé.")
        case .replaced: "Ce Live est ouvert sur un autre appareil."
        case .banned: "Vous avez été exclu de ce Live."
        case .failed(.liveNotFound): "Ce Live n'existe pas ou est terminé."
        case .failed: "Impossible de rejoindre ce Live."
        case .left: nil
        }
    }
}

private struct DockButton: View {
    let symbol: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(symbol)
                .font(.system(size: 24))
                .frame(width: 48, height: 48)
                .background(.black.opacity(0.45), in: Circle())
        }
        .accessibilityLabel(label)
    }
}

private struct QuickReactionButton: View {
    let emoji: String
    let onTap: () -> Void
    let onLongPress: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Text(emoji)
            .font(.system(size: 24))
            .frame(width: 48, height: 48)
            .background(.black.opacity(0.45), in: Circle())
            .opacity(isEnabled ? 1 : 0.5)
            .contentShape(Circle())
            .onTapGesture { if isEnabled { onTap() } }
            .onLongPressGesture(minimumDuration: 0.4) { if isEnabled { onLongPress() } }
            .accessibilityElement()
            .accessibilityLabel("Réagir \(emoji)")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { if isEnabled { onTap() } }
            .accessibilityAction(named: "Toutes les Réactions") { if isEnabled { onLongPress() } }
    }
}

private struct HostPresenceBanner: View {
    let connected: Bool
    @Environment(\.liveTheme) private var theme
    @State private var returned = false
    @State private var wasDisconnected = false

    var body: some View {
        VStack(spacing: 0) {
            if !connected || returned {
                Text(connected ? "Hôte revenu" : "Hôte déconnecté")
                    .font(theme.font(15, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: theme.cornerRadius))
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .task(id: connected) {
            if !connected {
                wasDisconnected = true
                returned = false
                return
            }
            guard wasDisconnected else { return }
            returned = true
            do { try await Task.sleep(for: .seconds(3)) } catch { return }
            returned = false
            wasDisconnected = false
        }
    }
}
