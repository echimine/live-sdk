import CryptoKit
import Foundation

enum DemoParticipantToken {
    static func sign(appId: String, secret: String, userId: String, name: String) -> String {
        let now = Int(Date().timeIntervalSince1970)
        let header = #"{"alg":"HS256","typ":"JWT"}"#
        let claims: [String: Any] = ["iss": appId, "sub": userId, "name": name, "iat": now, "exp": now + 5 * 60]
        let payload = (try? JSONSerialization.data(withJSONObject: claims)) ?? Data()
        let unsigned = "\(base64URL(Data(header.utf8))).\(base64URL(payload))"
        let signature = HMAC<SHA256>.authenticationCode(for: Data(unsigned.utf8), using: SymmetricKey(data: Data(secret.utf8)))
        return "\(unsigned).\(base64URL(Data(signature)))"
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
