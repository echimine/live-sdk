import LiveSDK
import SwiftUI

extension ModerationAction {
    var title: String {
        switch self {
        case .deleteMessage: "Supprimer le message"
        case .shadowban: "Shadowban"
        case .unshadowban: "Lever le Shadowban"
        case .ban: "Bannir du Live"
        }
    }

    var buttonRole: ButtonRole? {
        switch self {
        case .deleteMessage, .ban: .destructive
        case .shadowban, .unshadowban: nil
        }
    }

    func command(for message: ChatMessage) -> LiveCommand {
        switch self {
        case .deleteMessage: .deleteMessage(messageId: message.id)
        case .shadowban: .shadowban(participantId: message.author.id)
        case .unshadowban: .unshadowban(participantId: message.author.id)
        case .ban: .ban(participantId: message.author.id)
        }
    }
}

enum ModerationText {
    static func message(for error: LiveCommandError) -> String {
        switch error.code {
        case .notAnimator: error.message.isEmpty ? "Vous ne pouvez pas modérer ce Participant." : error.message
        case .notFound: "Ce message ou ce Participant n’est plus dans le Live."
        case .disconnected: "Connexion perdue. Réessayez."
        default: error.message.isEmpty ? "La modération a échoué. Réessayez." : error.message
        }
    }
}

/// Toucher un message (Animateurs) : supprimer, Shadowban ou Bannissement de son auteur.
private struct ModerationDialog: ViewModifier {
    let session: LiveSession
    @Binding var message: ChatMessage?
    @State private var error: String?

    func body(content: Content) -> some View {
        content
            .confirmationDialog(
                message.map { "Message de \($0.author.name)" } ?? "",
                isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } }),
                titleVisibility: .visible,
                presenting: message
            ) { target in
                ForEach(session.moderationActions(for: target), id: \.self) { action in
                    Button(action.title, role: action.buttonRole) {
                        run(action, on: target)
                    }
                }
                Button("Annuler", role: .cancel) {}
            } message: { target in
                if session.moderationActions(for: target).contains(.ban) {
                    Text("Un Participant banni est exclu de ce Live sans pouvoir y revenir.")
                }
            }
            .alert("Modération", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK") { error = nil }
            } message: {
                Text(error ?? "")
            }
            .onChange(of: session.status) { _, status in
                if status != .connected { message = nil }
            }
            .onChange(of: session.role) { closeIfStale() }
            .onChange(of: session.messages.map(\.id)) { closeIfStale() }
    }

    /// Redescendu Spectateur, ou message supprimé par un autre Animateur pendant que le menu était ouvert.
    private func closeIfStale() {
        guard let target = message else { return }
        if session.moderationActions(for: target).isEmpty || !session.messages.contains(where: { $0.id == target.id }) {
            message = nil
        }
    }

    private func run(_ action: ModerationAction, on target: ChatMessage) {
        Task {
            do throws(LiveCommandError) {
                try await session.send(action.command(for: target))
            } catch {
                if session.status == .connected { self.error = ModerationText.message(for: error) }
            }
        }
    }
}

extension View {
    func moderationDialog(session: LiveSession, message: Binding<ChatMessage?>) -> some View {
        modifier(ModerationDialog(session: session, message: message))
    }
}

/// Rend un message touchable quand l'Animateur peut agir dessus.
struct ModeratableMessage: ViewModifier {
    let session: LiveSession
    let message: ChatMessage
    let onSelect: (ChatMessage) -> Void

    func body(content: Content) -> some View {
        if session.moderationActions(for: message).isEmpty {
            content
        } else {
            content
                .contentShape(Rectangle())
                .onTapGesture { onSelect(message) }
                .accessibilityAddTraits(.isButton)
                .accessibilityHint("Modérer ce message")
        }
    }
}
