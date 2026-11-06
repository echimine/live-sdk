import Foundation

public enum Role: String, Sendable, Codable {
    case host
    case cohost
    case viewer
    case unknown

    public init(from decoder: Decoder) throws {
        self = Role(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

public struct Participant: Sendable, Hashable, Codable, Identifiable {
    public let id: String
    public let app: String
    public let name: String
    public let picture: URL?

    public init(id: String, app: String, name: String, picture: URL? = nil) {
        self.id = id
        self.app = app
        self.name = name
        self.picture = picture
    }
}
