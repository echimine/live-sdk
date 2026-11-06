import Foundation

enum ClientMessage: Equatable {
    case join(token: String)
    case react(emoji: String)
    case command(ref: String, LiveCommand)
}

extension ClientMessage: Codable {
    private enum CodingKeys: String, CodingKey {
        case type, ref, token, emoji, participantId, text, messageId, name, price, currency, imageUrl, productId
    }

    private enum DecodingFailure: Error {
        case unknownType(String)
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "join": self = .join(token: try container.decode(String.self, forKey: .token))
        case "react": self = .react(emoji: try container.decode(String.self, forKey: .emoji))
        default: self = .command(ref: try container.decode(String.self, forKey: .ref), try Self.command(type, in: container))
        }
    }

    private static func command(_ type: String, in container: KeyedDecodingContainer<CodingKeys>) throws -> LiveCommand {
        func participantId() throws -> String { try container.decode(String.self, forKey: .participantId) }
        switch type {
        case "endLive": return .endLive
        case "requestToJoin": return .requestToJoin
        case "cancelJoinRequest": return .cancelJoinRequest
        case "acceptJoin": return .acceptJoin(participantId: try participantId())
        case "declineJoin": return .declineJoin(participantId: try participantId())
        case "leaveStage": return .leaveStage
        case "removeCohost": return .removeCohost(participantId: try participantId())
        case "sendMessage": return .sendMessage(text: try container.decode(String.self, forKey: .text))
        case "deleteMessage": return .deleteMessage(messageId: try container.decode(String.self, forKey: .messageId))
        case "pinProduct":
            return .pinProduct(
                name: try container.decode(String.self, forKey: .name),
                price: try container.decode(Int.self, forKey: .price),
                currency: try container.decode(String.self, forKey: .currency),
                imageUrl: try container.decodeIfPresent(URL.self, forKey: .imageUrl)
            )
        case "unpinProduct": return .unpinProduct
        case "purchase": return .purchase(productId: try container.decode(String.self, forKey: .productId))
        case "shadowban": return .shadowban(participantId: try participantId())
        case "unshadowban": return .unshadowban(participantId: try participantId())
        case "ban": return .ban(participantId: try participantId())
        default: throw DecodingFailure.unknownType(type)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .join(let token):
            try container.encode("join", forKey: .type)
            try container.encode(token, forKey: .token)
        case .react(let emoji):
            try container.encode("react", forKey: .type)
            try container.encode(emoji, forKey: .emoji)
        case .command(let ref, let command):
            try container.encode(ref, forKey: .ref)
            try Self.encode(command, into: &container)
        }
    }

    private static func encode(_ command: LiveCommand, into container: inout KeyedEncodingContainer<CodingKeys>) throws {
        switch command {
        case .endLive: try container.encode("endLive", forKey: .type)
        case .requestToJoin: try container.encode("requestToJoin", forKey: .type)
        case .cancelJoinRequest: try container.encode("cancelJoinRequest", forKey: .type)
        case .acceptJoin(let id):
            try container.encode("acceptJoin", forKey: .type)
            try container.encode(id, forKey: .participantId)
        case .declineJoin(let id):
            try container.encode("declineJoin", forKey: .type)
            try container.encode(id, forKey: .participantId)
        case .leaveStage: try container.encode("leaveStage", forKey: .type)
        case .removeCohost(let id):
            try container.encode("removeCohost", forKey: .type)
            try container.encode(id, forKey: .participantId)
        case .sendMessage(let text):
            try container.encode("sendMessage", forKey: .type)
            try container.encode(text, forKey: .text)
        case .deleteMessage(let messageId):
            try container.encode("deleteMessage", forKey: .type)
            try container.encode(messageId, forKey: .messageId)
        case .pinProduct(let name, let price, let currency, let imageUrl):
            try container.encode("pinProduct", forKey: .type)
            try container.encode(name, forKey: .name)
            try container.encode(price, forKey: .price)
            try container.encode(currency, forKey: .currency)
            try container.encodeIfPresent(imageUrl, forKey: .imageUrl)
        case .unpinProduct: try container.encode("unpinProduct", forKey: .type)
        case .purchase(let productId):
            try container.encode("purchase", forKey: .type)
            try container.encode(productId, forKey: .productId)
        case .shadowban(let id):
            try container.encode("shadowban", forKey: .type)
            try container.encode(id, forKey: .participantId)
        case .unshadowban(let id):
            try container.encode("unshadowban", forKey: .type)
            try container.encode(id, forKey: .participantId)
        case .ban(let id):
            try container.encode("ban", forKey: .type)
            try container.encode(id, forKey: .participantId)
        }
    }
}
