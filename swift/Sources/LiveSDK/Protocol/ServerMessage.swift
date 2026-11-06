import Foundation

struct Snapshot: Codable, Equatable {
    struct Live: Codable, Equatable {
        let id: String
        let title: String?
        let startedAt: Date
    }

    struct LiveKit: Codable, Equatable {
        let url: URL
        let token: String
    }

    let live: Live
    let you: Participant
    let role: Role
    let host: Participant
    let hostConnected: Bool
    let cohosts: [Participant]
    let pinnedProduct: Product?
    let audience: Audience
    let reactionsTotal: Int
    let messages: [ChatMessage]
    let livekit: LiveKit
    let joinRequests: [Participant]?
    let moderation: Moderation?
}

extension Snapshot {
    private enum CodingKeys: String, CodingKey {
        case live, you, role, host, hostConnected, cohosts, pinnedProduct, audience, reactionsTotal, messages, livekit, joinRequests, moderation
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        live = try container.decode(Live.self, forKey: .live)
        you = try container.decode(Participant.self, forKey: .you)
        role = try container.decode(Role.self, forKey: .role)
        host = try container.decode(Participant.self, forKey: .host)
        hostConnected = try container.decode(Bool.self, forKey: .hostConnected)
        cohosts = try container.decode([Participant].self, forKey: .cohosts)
        pinnedProduct = try container.decodeIfPresent(Product.self, forKey: .pinnedProduct)
        audience = try container.decode(Audience.self, forKey: .audience)
        reactionsTotal = try container.decode(Int.self, forKey: .reactionsTotal)
        messages = try container.decode([Lossy<ChatMessage>].self, forKey: .messages).compactMap(\.value)
        livekit = try container.decode(LiveKit.self, forKey: .livekit)
        joinRequests = try container.decodeIfPresent([Participant].self, forKey: .joinRequests)
        moderation = try container.decodeIfPresent(Moderation.self, forKey: .moderation)
    }
}

private struct Lossy<Value: Decodable>: Decodable {
    let value: Value?

    init(from decoder: Decoder) throws {
        value = try? Value(from: decoder)
    }
}

struct ServerError: Codable, Equatable {
    let ref: String?
    let code: LiveErrorCode
    let message: String
    let retryAfterMs: Int?
}

struct LiveEnded: Codable, Equatable {
    let reason: LiveEndReason
    let summary: LiveRecap?
}

struct RoleChanged: Codable, Equatable {
    let participant: Participant
    let role: Role
}

struct ReactionsUpdate: Codable, Equatable {
    let counts: [String: Int]
    let total: Int
}

enum ServerMessage: Equatable {
    case ack(ref: String)
    case error(ServerError)
    case snapshot(Snapshot)
    case replaced
    case hostDisconnected
    case hostReconnected
    case liveEnded(LiveEnded)
    case joinRequested(Participant)
    case joinRequestCancelled(participantId: String)
    case roleChanged(RoleChanged)
    case audience(Audience)
    case reactions(ReactionsUpdate)
    case chatMessage(ChatMessage)
    case messageDeleted(messageId: String)
    case productPinned(Product)
    case productUnpinned
    case banned
    case moderationChanged(Moderation)
    case unknown(type: String)
}

extension ServerMessage: Codable {
    private enum CodingKeys: String, CodingKey {
        case type, ref, participant, participantId, message, messageId, product
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "ack": self = .ack(ref: try container.decode(String.self, forKey: .ref))
        case "error": self = .error(try ServerError(from: decoder))
        case "snapshot": self = .snapshot(try Snapshot(from: decoder))
        case "replaced": self = .replaced
        case "hostDisconnected": self = .hostDisconnected
        case "hostReconnected": self = .hostReconnected
        case "liveEnded": self = .liveEnded(try LiveEnded(from: decoder))
        case "joinRequested": self = .joinRequested(try container.decode(Participant.self, forKey: .participant))
        case "joinRequestCancelled": self = .joinRequestCancelled(participantId: try container.decode(String.self, forKey: .participantId))
        case "roleChanged": self = .roleChanged(try RoleChanged(from: decoder))
        case "audience": self = .audience(try Audience(from: decoder))
        case "reactions": self = .reactions(try ReactionsUpdate(from: decoder))
        case "chatMessage": self = .chatMessage(try container.decode(ChatMessage.self, forKey: .message))
        case "messageDeleted": self = .messageDeleted(messageId: try container.decode(String.self, forKey: .messageId))
        case "productPinned": self = .productPinned(try container.decode(Product.self, forKey: .product))
        case "productUnpinned": self = .productUnpinned
        case "banned": self = .banned
        case "moderationChanged": self = .moderationChanged(try Moderation(from: decoder))
        default: self = .unknown(type: type)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .ack(let ref):
            try container.encode("ack", forKey: .type)
            try container.encode(ref, forKey: .ref)
        case .error(let error):
            try container.encode("error", forKey: .type)
            try error.encode(to: encoder)
        case .snapshot(let snapshot):
            try container.encode("snapshot", forKey: .type)
            try snapshot.encode(to: encoder)
        case .replaced: try container.encode("replaced", forKey: .type)
        case .hostDisconnected: try container.encode("hostDisconnected", forKey: .type)
        case .hostReconnected: try container.encode("hostReconnected", forKey: .type)
        case .liveEnded(let ended):
            try container.encode("liveEnded", forKey: .type)
            try ended.encode(to: encoder)
        case .joinRequested(let participant):
            try container.encode("joinRequested", forKey: .type)
            try container.encode(participant, forKey: .participant)
        case .joinRequestCancelled(let participantId):
            try container.encode("joinRequestCancelled", forKey: .type)
            try container.encode(participantId, forKey: .participantId)
        case .roleChanged(let change):
            try container.encode("roleChanged", forKey: .type)
            try change.encode(to: encoder)
        case .audience(let audience):
            try container.encode("audience", forKey: .type)
            try audience.encode(to: encoder)
        case .reactions(let reactions):
            try container.encode("reactions", forKey: .type)
            try reactions.encode(to: encoder)
        case .chatMessage(let message):
            try container.encode("chatMessage", forKey: .type)
            try container.encode(message, forKey: .message)
        case .messageDeleted(let messageId):
            try container.encode("messageDeleted", forKey: .type)
            try container.encode(messageId, forKey: .messageId)
        case .productPinned(let product):
            try container.encode("productPinned", forKey: .type)
            try container.encode(product, forKey: .product)
        case .productUnpinned: try container.encode("productUnpinned", forKey: .type)
        case .banned: try container.encode("banned", forKey: .type)
        case .moderationChanged(let moderation):
            try container.encode("moderationChanged", forKey: .type)
            try moderation.encode(to: encoder)
        case .unknown(let type): try container.encode(type, forKey: .type)
        }
    }
}
