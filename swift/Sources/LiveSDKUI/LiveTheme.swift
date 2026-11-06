import SwiftUI

public struct LiveTheme: Sendable {
    public var accent: Color
    public var cornerRadius: CGFloat
    public var fontName: String?
    public var label: String

    public init(
        accent: Color = Color(red: 1, green: 0.176, blue: 0.333),
        cornerRadius: CGFloat = 14,
        fontName: String? = nil,
        label: String = "Crosslive"
    ) {
        self.accent = accent
        self.cornerRadius = cornerRadius
        self.fontName = fontName
        self.label = label
    }

    func font(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        guard let fontName else { return .system(size: size, weight: weight) }
        return .custom(fontName, size: size).weight(weight)
    }
}

extension EnvironmentValues {
    @Entry var liveTheme = LiveTheme()
}

extension View {
    public func liveTheme(_ theme: LiveTheme) -> some View {
        environment(\.liveTheme, theme)
    }
}
