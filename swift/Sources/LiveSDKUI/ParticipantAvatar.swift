import LiveSDK
import SwiftUI

struct ParticipantAvatar: View {
    let participant: Participant
    let size: CGFloat
    @Environment(\.liveTheme) private var theme

    var body: some View {
        AsyncImage(url: participant.picture) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else {
                Text(participant.initial)
                    .font(theme.font(size * 0.45, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(theme.accent)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}
