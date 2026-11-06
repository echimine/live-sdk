import Foundation
import LiveSDK

public enum LiveLink {
    public static func liveId(from input: String) -> String? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.contains("://") else { return isLiveId(trimmed) ? trimmed : nil }
        guard let last = URL(string: trimmed)?.path.split(separator: "/").last.map(String.init),
              last != "lives", isLiveId(last)
        else { return nil }
        return last
    }

    private static func isLiveId(_ candidate: String) -> Bool {
        !candidate.isEmpty && candidate.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
    }
}

public enum LiveTitle {
    public static let maxLength = 80

    public static func limited(_ text: String) -> String {
        String(text.prefix(maxLength))
    }

    public static func visibleLength(_ text: String) -> Int {
        text.count
    }
}

extension Participant {
    public var initial: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines).first.map { String($0).uppercased() } ?? "?"
    }
}
