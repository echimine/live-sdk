import LiveSDK
import SwiftUI

struct ChatMessageRow: View {
    let message: ChatMessage
    let onVideo: Bool
    @Environment(\.liveTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(message.author.name).font(theme.font(13, weight: .semibold))
                Text(message.author.app).font(theme.font(11)).opacity(0.7)
                if let badge = roleBadge {
                    Text(badge)
                        .font(theme.font(10, weight: .bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(theme.accent, in: Capsule())
                        .foregroundStyle(.white)
                }
            }
            Text(content).font(theme.font(15))
        }
        .foregroundStyle(onVideo ? Color.white : Color.primary)
        .accessibilityElement(children: .combine)
    }

    private var roleBadge: String? {
        switch message.role {
        case .host: "Hôte"
        case .cohost: "Co-hôte"
        case .viewer, .unknown: nil
        }
    }

    private var content: String {
        switch message.content {
        case .text(let text):
            text
        case .purchase(let product):
            "🛍 a acheté \(product.name) · \(PriceText.format(cents: product.price, currency: product.currency))"
        }
    }
}

enum PriceText {
    static func format(cents: Int, currency: String) -> String {
        (Decimal(cents) / 100).formatted(.currency(code: currency))
    }
}

struct RecentMessages: View {
    let session: LiveSession
    let onSelect: (ChatMessage) -> Void
    @Environment(\.liveTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(session.messages.suffix(2)) { message in
                ChatMessageRow(message: message, onVideo: true)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.black.opacity(0.45), in: RoundedRectangle(cornerRadius: theme.cornerRadius))
                    .modifier(ModeratableMessage(session: session, message: message, onSelect: onSelect))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.easeOut(duration: 0.2), value: session.messages.last?.id)
    }
}

struct ChatSheet: View {
    let session: LiveSession
    @Environment(\.liveTheme) private var theme
    @State private var draft = ""
    @State private var sendError: String?
    @State private var sending = false
    @State private var selectedForModeration: ChatMessage?

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(session.messages) { message in
                            ChatMessageRow(message: message, onVideo: false)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .modifier(ModeratableMessage(session: session, message: message) { selectedForModeration = $0 })
                                .id(message.id)
                        }
                    }
                    .padding(16)
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: session.messages.last?.id) { _, last in
                    withAnimation { proxy.scrollTo(last, anchor: .bottom) }
                }
            }
            Divider()
            composer
        }
        .moderationDialog(session: session, message: $selectedForModeration)
        .font(theme.font(16))
        .tint(theme.accent)
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                if let unlockAt = session.chatUnlockAt {
                    // Décompte du verrou posé après un `rate_limited` : « Doucement… 4 s ».
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let remaining = max(0, Int(unlockAt.timeIntervalSince(context.date).rounded(.up)))
                        TextField("Doucement… \(remaining) s", text: $draft)
                            .textFieldStyle(.roundedBorder)
                            .disabled(true)
                    }
                } else {
                    TextField("Votre message", text: $draft)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.send)
                        .onSubmit(send)
                }
                Button(action: send) {
                    Image(systemName: "paperplane.fill")
                }
                .disabled(session.chatLocked || sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel("Envoyer")
            }
            HStack {
                if let sendError {
                    Text(sendError).foregroundStyle(.red)
                }
                Spacer()
                Text("\(draft.trimmingCharacters(in: .whitespacesAndNewlines).count) / \(session.config.chat.maxLength)")
                    .foregroundStyle(tooLong ? .red : .secondary)
            }
            .font(theme.font(12))
        }
        .padding(12)
    }

    private var tooLong: Bool {
        draft.trimmingCharacters(in: .whitespacesAndNewlines).count > session.config.chat.maxLength
    }

    private func send() {
        guard !sending else { return }
        sending = true
        sendError = nil
        let text = draft
        Task {
            defer { sending = false }
            do throws(LiveCommandError) {
                try await session.sendMessage(text)
                if draft == text { draft = "" }
            } catch {
                // `rate_limited` : le décompte du verrou remplace le message.
                sendError = error.code == .rateLimited ? nil : error.displayMessage
            }
        }
    }
}
