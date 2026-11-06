import SwiftUI

/// Le chrome commun des boutons ronds posés sur la vidéo : symbole centré, disque sombre translucide.
struct DockChrome: ViewModifier {
    var size: CGFloat = 48
    var font: Font = .system(size: 24)
    var background: AnyShapeStyle = AnyShapeStyle(.black.opacity(0.45))

    func body(content: Content) -> some View {
        content
            .font(font)
            .frame(width: size, height: size)
            .background(background, in: Circle())
    }
}

extension View {
    func dockChrome(size: CGFloat = 48, font: Font = .system(size: 24), background: AnyShapeStyle = AnyShapeStyle(.black.opacity(0.45))) -> some View {
        modifier(DockChrome(size: size, font: font, background: background))
    }
}

struct DockButton: View {
    let symbol: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(symbol).dockChrome()
        }
        .accessibilityLabel(label)
    }
}

/// ❤️ du dock : un tap réagit, un appui long ouvre toutes les Réactions.
struct QuickReactionButton: View {
    let emoji: String
    let onTap: () -> Void
    let onLongPress: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Text(emoji)
            .dockChrome()
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

/// ✕ de la barre du haut.
struct CloseButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .foregroundStyle(.white)
                .dockChrome(size: 36, font: .system(size: 15, weight: .bold))
        }
        .accessibilityLabel(label)
    }
}
