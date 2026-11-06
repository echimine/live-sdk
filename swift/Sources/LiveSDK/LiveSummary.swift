import Foundation

public struct LiveSummary: Sendable, Hashable, Codable, Identifiable {
    public let id: String
    public let title: String?
    public let host: Participant
    public let audience: Int
    public let startedAt: Date
}
