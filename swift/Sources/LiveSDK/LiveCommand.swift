import Foundation

public enum LiveCommand: Sendable, Hashable {
    case endLive
    case requestToJoin
    case cancelJoinRequest
    case acceptJoin(participantId: String)
    case declineJoin(participantId: String)
    case leaveStage
    case removeCohost(participantId: String)
    case sendMessage(text: String)
    case deleteMessage(messageId: String)
    case pinProduct(name: String, price: Int, currency: String, imageUrl: URL?)
    case unpinProduct
    case purchase(productId: String)
    case shadowban(participantId: String)
    case unshadowban(participantId: String)
    case ban(participantId: String)
}

public struct LiveCommandError: Error, Sendable, Hashable {
    public let code: LiveErrorCode
    public let message: String
    public let retryAfter: Duration?

    public init(code: LiveErrorCode, message: String, retryAfter: Duration? = nil) {
        self.code = code
        self.message = message
        self.retryAfter = retryAfter
    }
}
