public struct LiveConfig: Sendable, Equatable, Codable {
    public struct Chat: Sendable, Equatable, Codable {
        public let maxLength: Int
    }

    public struct Images: Sendable, Equatable, Codable {
        public let maxBytes: Int
        public let formats: [String]
    }

    public struct Product: Sendable, Equatable, Codable {
        public let nameMaxLength: Int
    }

    public let reactions: [String]
    public let chat: Chat
    public let images: Images
    public let product: Product
}

extension LiveConfig {
    public static let defaults = LiveConfig(
        reactions: ["❤️", "😂", "😮", "👏", "🔥", "😢", "😍", "🎉", "💯", "👍", "🤯", "🙏"],
        chat: Chat(maxLength: 300),
        images: Images(maxBytes: 10_485_760, formats: ["image/jpeg", "image/png", "image/webp"]),
        product: Product(nameMaxLength: 80)
    )
}
