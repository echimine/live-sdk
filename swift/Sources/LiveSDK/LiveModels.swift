import Foundation

public struct Product: Sendable, Hashable, Codable, Identifiable {
    public let id: String
    public let name: String
    public let price: Int
    public let currency: String
    public let imageUrl: URL?
}

public struct PurchasedProduct: Sendable, Hashable, Codable, Identifiable {
    public let id: String
    public let name: String
    public let price: Int
    public let currency: String
}

public struct Audience: Sendable, Hashable, Codable {
    public let total: Int
    public let byApp: [String: Int]

    public static let empty = Audience(total: 0, byApp: [:])
}

public struct ChatMessage: Sendable, Hashable, Identifiable {
    public enum Content: Sendable, Hashable {
        case text(String)
        case purchase(PurchasedProduct)
    }

    public let id: String
    public let author: Participant
    public let role: Role
    public let at: Date
    public let content: Content
}

extension ChatMessage: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, author, role, at, kind, text, product
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        author = try container.decode(Participant.self, forKey: .author)
        role = try container.decode(Role.self, forKey: .role)
        at = try container.decode(Date.self, forKey: .at)
        switch try container.decode(String.self, forKey: .kind) {
        case "purchase":
            content = .purchase(try container.decode(PurchasedProduct.self, forKey: .product))
        case "text":
            content = .text(try container.decode(String.self, forKey: .text))
        case let kind:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "Type de message inconnu : \(kind)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(author, forKey: .author)
        try container.encode(role, forKey: .role)
        try container.encode(at, forKey: .at)
        switch content {
        case .text(let text):
            try container.encode("text", forKey: .kind)
            try container.encode(text, forKey: .text)
        case .purchase(let product):
            try container.encode("purchase", forKey: .kind)
            try container.encode(product, forKey: .product)
        }
    }
}

public struct Moderation: Sendable, Hashable, Codable {
    public let shadowbanned: [Participant]
    public let banned: [Participant]
}

public enum LiveEndReason: String, Sendable, Codable {
    case endedByHost
    case hostTimeout
    case unknown

    public init(from decoder: Decoder) throws {
        self = LiveEndReason(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

public struct LiveRecap: Sendable, Hashable, Codable {
    public let purchases: Int
    public let reactions: Int
    public let peakAudience: Int

    public init(purchases: Int, reactions: Int, peakAudience: Int) {
        self.purchases = purchases
        self.reactions = reactions
        self.peakAudience = peakAudience
    }
}

public enum LiveErrorCode: String, Sendable, Codable {
    case invalidToken = "invalid_token"
    case liveNotFound = "live_not_found"
    case banned
    case notHost = "not_host"
    case notAnimator = "not_animator"
    case cohostLimit = "cohost_limit"
    case rateLimited = "rate_limited"
    case productChanged = "product_changed"
    case invalidMessage = "invalid_message"
    case invalidProduct = "invalid_product"
    case invalidCommand = "invalid_command"
    case unknownCommand = "unknown_command"
    case notFound = "not_found"
    case disconnected
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = LiveErrorCode(rawValue: raw) ?? .unknown
    }
}
