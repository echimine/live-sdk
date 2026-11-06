import LiveSDK
import SwiftUI

struct ReactionsSheet: View {
    let session: LiveSession
    @Environment(\.liveTheme) private var theme

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 4), spacing: 16) {
            ForEach(session.config.reactions, id: \.self) { emoji in
                Button { session.react(emoji) } label: {
                    Text(emoji).font(.system(size: 36)).frame(maxWidth: .infinity, minHeight: 56)
                }
                .accessibilityLabel("Réagir \(emoji)")
            }
        }
        .padding(20)
        .frame(maxHeight: .infinity, alignment: .top)
    }
}

struct FloatingReaction: Identifiable {
    let id = UUID()
    let emoji: String
    let drift: CGFloat
}

struct ReactionsOverlay: View {
    let session: LiveSession
    @State private var floating: [FloatingReaction] = []

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            ForEach(floating) { reaction in
                RisingEmoji(reaction: reaction) {
                    floating.removeAll { $0.id == reaction.id }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .task(id: session.id) {
            for await event in session.events() {
                guard case .reactions(let counts) = event else { continue }
                let burst = counts.flatMap { emoji, count in
                    (0..<min(count, 8)).map { _ in FloatingReaction(emoji: emoji, drift: .random(in: -40...20)) }
                }
                floating = Array((floating + burst).suffix(40))
            }
        }
    }
}

private struct RisingEmoji: View {
    let reaction: FloatingReaction
    let onFinish: () -> Void
    @State private var risen = false

    var body: some View {
        Text(reaction.emoji)
            .font(.system(size: 32))
            .offset(x: risen ? reaction.drift : 0, y: risen ? -320 : 0)
            .opacity(risen ? 0 : 1)
            .padding(.trailing, 24)
            .padding(.bottom, 80)
            .onAppear {
                withAnimation(.easeOut(duration: 2)) { risen = true } completion: { onFinish() }
            }
    }
}
