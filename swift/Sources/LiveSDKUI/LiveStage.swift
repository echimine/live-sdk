import LiveSDK
import SwiftUI

/// Le Live en plein écran : mosaïque, barre du haut, 2 derniers messages, dock et feuilles.
struct LiveStage: View {
    let session: LiveSession
    let onClose: () -> Void
    @Environment(\.liveTheme) private var theme
    @Environment(\.productSource) private var productSource
    @State private var productOpen = false
    @State private var chatOpen = false
    @State private var reactionsOpen = false
    @State private var audienceOpen = false
    @State private var recapOpen = false
    @State private var managementOpen = false
    @State private var confirmingEnd = false
    @State private var confirmingLeaveStage = false
    @State private var ending = false
    @State private var commandError: String?
    @State private var stageError: String?
    @State private var selectedForModeration: ChatMessage?
    /// « Terminer le Live » touché dans ⚙️ Gestion : confirmé une fois la feuille fermée.
    @State private var confirmEndAfterSheet = false

    private var interactive: Bool { session.status == .connected }
    private var recap: LiveRecap? {
        guard case .ended(_, let recap) = session.status, session.role == .host else { return nil }
        return recap
    }

    var body: some View {
        ZStack {
            StageVideo(session: session).ignoresSafeArea()
            ReactionsOverlay(session: session)
            LiveToast(session: session)
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
                    RecentMessages(session: session) { selectedForModeration = $0 }
                    dock
                } else if showsCloseButton {
                    Button("Fermer", action: onClose)
                        .buttonStyle(.borderedProminent)
                }
            }
            .padding(16)
        }
        .sheet(isPresented: Binding(
            get: { chatOpen || reactionsOpen || audienceOpen || recapOpen || productOpen || managementOpen },
            set: { if !$0 { closeSheets() } }
        ), onDismiss: {
            if recap != nil { onClose() }
            if confirmEndAfterSheet {
                confirmEndAfterSheet = false
                confirmingEnd = interactive && session.role == .host
            }
        }) {
            Group {
                if let recap {
                    NavigationStack { LiveRecapSheet(recap: recap, onClose: closeSheets) }
                        .interactiveDismissDisabled()
                } else if managementOpen {
                    NavigationStack {
                        ManagementSheet(session: session, productSource: productSource, onEndLive: {
                            confirmEndAfterSheet = true
                            closeSheets()
                        }, onClose: closeSheets)
                    }
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
            if role != .host && role != .cohost { managementOpen = false }
            if role != .cohost { confirmingLeaveStage = false }
        }
        .onChange(of: session.status, initial: true) { _, _ in
            if !interactive {
                confirmingEnd = false
                confirmingLeaveStage = false
                commandError = nil
                stageError = nil
                managementOpen = false
                // Garder la même présentation lors du passage au récapitulatif.
                recapOpen = recap != nil
                chatOpen = false
                reactionsOpen = false
                audienceOpen = false
                productOpen = false
            }
        }
        .moderationDialog(session: session, message: $selectedForModeration)
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
            // Pour l'Hôte, ✕ propose de terminer le Live (aussi depuis ⚙️ Gestion).
            CloseButton(label: session.role == .host && interactive ? "Terminer le Live" : "Quitter le Live", action: quit)
                .disabled(ending)
        }
    }

    private var dock: some View {
        HStack(spacing: 12) {
            DockButton(symbol: "💬", label: "Ouvrir le chat") { chatOpen = true }
            DockButton(symbol: "🛍", label: "Produit épinglé") { productOpen = true }
            Spacer()
            Group {
                switch session.role {
                case .host:
                    BadgedDockButton(symbol: "⚙️", label: "Gestion", badge: session.joinRequests.count) { managementOpen = true }
                case .cohost:
                    Button("Redescendre") { confirmingLeaveStage = true }
                        .buttonStyle(.borderedProminent)
                    BadgedDockButton(symbol: "⚙️", label: "Gestion", badge: 0) { managementOpen = true }
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
        managementOpen = false
    }

    private func leaveStage() async {
        guard interactive, session.role == .cohost else { return }
        do {
            try await session.send(.leaveStage)
        } catch {
            // Déjà redescendu (retiré par l'Hôte entre-temps) : rien à signaler.
            if interactive && session.role == .cohost {
                stageError = error.displayMessage
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
                commandError = error.displayMessage
            }
        }
    }

    private var showsCloseButton: Bool {
        switch session.status {
        case .ended: recap == nil
        case .banned: true
        default: false
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
        case .banned: "Vous avez été exclu de ce Live. Vous pouvez rejoindre d’autres Lives."
        case .failed(.liveNotFound): "Ce Live n'existe pas ou est terminé."
        case .failed(.invalidToken): "Votre identité n’a pas été reconnue. Reconnectez-vous à l’app."
        case .failed: "Impossible de rejoindre ce Live."
        case .left: nil
        }
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
