import LiveSDK
import SwiftUI

/// ⚙️ Gestion de l'Hôte : Demandes de montée à accepter ou refuser, Co-hôtes à retirer.
struct StageManagementSheet: View {
    let session: LiveSession
    let onClose: () -> Void
    @Environment(\.liveTheme) private var theme
    @State private var busy: Set<String> = []
    @State private var error: String?

    private var stageFull: Bool { session.cohosts.count >= LiveSession.maxCohosts }

    var body: some View {
        List {
            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }
            Section {
                if session.joinRequests.isEmpty {
                    Text("Aucune Demande de montée.")
                }
                ForEach(session.joinRequests) { participant in
                    HStack {
                        ParticipantRow(participant: participant)
                        Spacer()
                        Button("Refuser") { run(.declineJoin(participantId: participant.id), for: participant) }
                            .buttonStyle(.bordered)
                        Button("Accepter") { run(.acceptJoin(participantId: participant.id), for: participant) }
                            .buttonStyle(.borderedProminent)
                            .disabled(stageFull)
                    }
                    .disabled(busy.contains(participant.id))
                }
            } header: {
                Text("Demandes de montée")
            } footer: {
                if stageFull && !session.joinRequests.isEmpty {
                    Text(Self.stageFullMessage)
                }
            }
            Section("Co-hôtes (\(session.cohosts.count)/\(LiveSession.maxCohosts))") {
                if session.cohosts.isEmpty {
                    Text("Personne n’est monté à l’écran.")
                }
                ForEach(session.cohosts) { participant in
                    HStack {
                        ParticipantRow(participant: participant)
                        Spacer()
                        Button("Retirer", role: .destructive) {
                            run(.removeCohost(participantId: participant.id), for: participant)
                        }
                        .buttonStyle(.bordered)
                    }
                    .disabled(busy.contains(participant.id))
                }
            }
        }
        .font(theme.font(16))
        .tint(theme.accent)
        .navigationTitle("Gestion")
        .toolbar { Button("Fermer", action: onClose) }
    }

    private func run(_ command: LiveCommand, for participant: LiveParticipant) {
        busy.insert(participant.id)
        error = nil
        Task {
            defer { busy.remove(participant.id) }
            do throws(LiveCommandError) {
                try await session.send(command)
            } catch {
                self.error = Self.message(for: error)
            }
        }
    }

    private static let stageFullMessage = "Déjà \(LiveSession.maxCohosts) Co-hôtes à l’écran : retirez-en un pour accepter."

    static func message(for error: LiveCommandError) -> String {
        switch error.code {
        case .cohostLimit: stageFullMessage
        case .notFound: "Cette demande n’est plus d’actualité."
        case .disconnected: "Connexion perdue. Réessayez."
        default: error.message.isEmpty ? "La demande a échoué. Réessayez." : error.message
        }
    }
}

private struct ParticipantRow: View {
    let participant: LiveParticipant
    @Environment(\.liveTheme) private var theme

    var body: some View {
        HStack(spacing: 10) {
            ParticipantAvatar(participant: participant, size: 32)
            VStack(alignment: .leading, spacing: 0) {
                Text(participant.name)
                Text(participant.app).font(theme.font(12)).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Bouton du dock avec un compteur, pour ⚙️ Gestion (Demandes de montée en attente).
struct BadgedDockButton: View {
    let symbol: String
    let label: String
    let badge: Int
    let action: () -> Void
    @Environment(\.liveTheme) private var theme

    var body: some View {
        Button(action: action) {
            Text(symbol)
                .font(.system(size: 24))
                .frame(width: 48, height: 48)
                .background(.black.opacity(0.45), in: Circle())
                .overlay(alignment: .topTrailing) {
                    if badge > 0 {
                        Text(badge.formatted())
                            .font(theme.font(12, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .frame(minWidth: 20, minHeight: 20)
                            .background(theme.accent, in: Capsule())
                            .offset(x: 4, y: -4)
                    }
                }
        }
        .accessibilityLabel(badge > 0 ? "\(label), \(badge) Demandes de montée" : label)
    }
}

/// ✋ du Spectateur : demander à monter (caméra et micro autorisés d'abord), ou annuler sa demande.
struct JoinRequestButton: View {
    let session: LiveSession
    let onError: (String) -> Void
    @Environment(\.liveTheme) private var theme
    @State private var sending = false

    var body: some View {
        Button {
            Task { await toggle() }
        } label: {
            Text("✋")
                .font(.system(size: 24))
                .frame(width: 48, height: 48)
                .background(session.joinRequestPending ? AnyShapeStyle(theme.accent) : AnyShapeStyle(.black.opacity(0.45)), in: Circle())
        }
        .disabled(sending)
        .accessibilityLabel(session.joinRequestPending ? "Annuler ma Demande de montée" : "Demander à monter à l’écran")
    }

    private func toggle() async {
        sending = true
        defer { sending = false }
        let pending = session.joinRequestPending
        if !pending {
            let camera = await DevicePermission.request(.video)
            let microphone = await DevicePermission.request(.audio)
            guard camera && microphone else {
                onError("Autorisez la caméra et le micro dans les Réglages pour monter à l’écran.")
                return
            }
        }
        do throws(LiveCommandError) {
            try await session.send(pending ? .cancelJoinRequest : .requestToJoin)
        } catch {
            onError(error.message.isEmpty ? "La demande n’a pas pu être envoyée. Réessayez." : error.message)
        }
    }
}
