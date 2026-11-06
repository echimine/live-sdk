import LiveSDK
import SwiftUI

/// Cadre du Live. L'App membre fournit son contenu vidéo et ferme l'écran via `onClose`.
@MainActor
public struct LiveScreen<Content: View>: View {
    private let session: LiveSession
    private let onClose: () -> Void
    private let content: Content
    @State private var showingSheet = false
    @State private var confirmingEnd = false
    @State private var ending = false
    @State private var commandError: String?

    public init(session: LiveSession, onClose: @escaping () -> Void, @ViewBuilder content: () -> Content) {
        self.session = session
        self.onClose = onClose
        self.content = content()
    }

    private var interactive: Bool { session.status == .connected }
    private var recap: LiveRecap? {
        guard case .ended(_, let recap) = session.status, session.role == .host else { return nil }
        return recap
    }

    public var body: some View {
        ZStack {
            content
            VStack {
                HStack {
                    Text(session.title ?? "Crosslive").font(.headline)
                    Spacer()
                    Button {
                        showingSheet = true
                    } label: {
                        Label(session.audience.total.formatted(), systemImage: "eye")
                    }
                    .accessibilityLabel("Audience : \(session.audience.total.formatted()) Spectateurs")
                    .disabled(!interactive)
                    Button(action: quit) {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel(session.role == .host && interactive ? "Terminer le Live" : "Fermer le Live")
                    .disabled(ending)
                }
                .padding()
                .background(.regularMaterial)
                if interactive && session.role != .host {
                    HostPresenceBanner(connected: session.hostConnected)
                }
                Spacer()
                if let statusMessage {
                    VStack(spacing: 12) {
                        Text(statusMessage).multilineTextAlignment(.center)
                        if interactive == false && session.status != .connecting && session.status != .reconnecting {
                            Button("Fermer", action: onClose)
                        }
                    }
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                }
                Spacer()
                if session.role == .host && interactive {
                    Button("Terminer le Live", role: .destructive) { confirmingEnd = true }
                        .buttonStyle(.borderedProminent)
                        .disabled(ending)
                        .padding()
                }
            }
        }
        .sheet(isPresented: $showingSheet, onDismiss: {
            if recap != nil { onClose() }
        }) {
            NavigationStack {
                if let recap {
                    LiveRecapSheet(recap: recap) { showingSheet = false }
                        .interactiveDismissDisabled()
                } else {
                    AudienceSheet(audience: session.audience) { showingSheet = false }
                }
            }
            .presentationDetents([.medium, .large])
        }
        .confirmationDialog("Terminer le Live pour tous les Participants ?", isPresented: $confirmingEnd, titleVisibility: .visible) {
            Button("Terminer le Live", role: .destructive) {
                Task { await endLive() }
            }
            Button("Annuler", role: .cancel) {}
        }
        .alert("Impossible de terminer le Live", isPresented: Binding(
            get: { commandError != nil }, set: { if !$0 { commandError = nil } }
        )) {
            Button("OK") { commandError = nil }
        } message: {
            Text(commandError ?? "Réessayez.")
        }
        .onChange(of: session.status, initial: true) { _, status in
            if case .ended = status {
                showingSheet = recap != nil
            } else if status != .connected {
                showingSheet = false
            }
            if !interactive { confirmingEnd = false }
        }
        .onDisappear { Task { await session.leave() } }
    }

    private var statusMessage: String? {
        switch session.status {
        case .connecting: "Connexion au Live…"
        case .reconnecting: "Connexion perdue, reconnexion…"
        case .connected: nil
        case .ended(let reason, _):
            recap != nil ? nil : (reason == .hostTimeout ? "Le Live est terminé : l’Hôte n’est pas revenu." : "Le Live est terminé.")
        case .replaced: "Ce Live est ouvert sur un autre appareil."
        case .banned: "Vous avez été banni de ce Live."
        case .failed: "Impossible d’ouvrir ce Live."
        case .left: "Vous avez quitté le Live."
        }
    }

    private func quit() {
        switch session.status {
        case .connecting, .connected, .reconnecting:
            if session.role == .host {
                confirmingEnd = true
            } else {
                Task {
                    await session.leave()
                    onClose()
                }
            }
        default:
            onClose()
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
}

private struct HostPresenceBanner: View {
    let connected: Bool
    @State private var returned = false
    @State private var wasDisconnected = false

    var body: some View {
        Group {
            if !connected || returned {
                Text(connected ? "Hôte revenu" : "Hôte déconnecté")
                    .padding()
                    .background(.regularMaterial, in: Capsule())
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
