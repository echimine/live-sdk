import Foundation

struct ServedConfig: Decodable {
    private struct Chat: Decodable {
        let maxLength: Int?

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            maxLength = try? container.decode(Int.self, forKey: .maxLength)
        }

        private enum CodingKeys: String, CodingKey { case maxLength }
    }

    private struct Images: Decodable {
        let maxBytes: Int?
        let formats: [String]?

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            maxBytes = try? container.decode(Int.self, forKey: .maxBytes)
            formats = try? container.decode([String].self, forKey: .formats)
        }

        private enum CodingKeys: String, CodingKey { case maxBytes, formats }
    }

    private struct Product: Decodable {
        let nameMaxLength: Int?

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            nameMaxLength = try? container.decode(Int.self, forKey: .nameMaxLength)
        }

        private enum CodingKeys: String, CodingKey { case nameMaxLength }
    }

    private enum CodingKeys: String, CodingKey { case reactions, chat, images, product }

    private let reactions: [String]?
    private let chat: Chat?
    private let images: Images?
    private let product: Product?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        reactions = try? container.decode([String].self, forKey: .reactions)
        chat = try? container.decode(Chat.self, forKey: .chat)
        images = try? container.decode(Images.self, forKey: .images)
        product = try? container.decode(Product.self, forKey: .product)
    }

    func resolved(over fallback: LiveConfig) -> LiveConfig {
        LiveConfig(
            reactions: reactions.valid { (4...16).contains($0.count) && $0.allSatisfy { !$0.isEmpty } } ?? fallback.reactions,
            chat: LiveConfig.Chat(
                maxLength: chat?.maxLength.valid(\.isPositive) ?? fallback.chat.maxLength
            ),
            images: LiveConfig.Images(
                maxBytes: images?.maxBytes.valid(\.isPositive) ?? fallback.images.maxBytes,
                formats: images?.formats.valid { !$0.isEmpty && $0.allSatisfy { !$0.isEmpty } } ?? fallback.images.formats
            ),
            product: LiveConfig.Product(
                nameMaxLength: product?.nameMaxLength.valid(\.isPositive) ?? fallback.product.nameMaxLength
            )
        )
    }
}

private extension Int {
    var isPositive: Bool { self > 0 }
}

private extension Optional {
    func valid(_ isValid: (Wrapped) -> Bool) -> Wrapped? {
        flatMap { isValid($0) ? $0 : nil }
    }
}
