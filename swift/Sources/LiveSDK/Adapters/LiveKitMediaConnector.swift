import Foundation
import LiveKit

final class LiveKitMediaConnector: MediaConnector {
    let room = Room(roomOptions: RoomOptions(
        defaultVideoPublishOptions: VideoPublishOptions(simulcast: true),
        adaptiveStream: true,
        dynacast: true
    ))

    func connect(url: URL, token: String) async throws {
        try await room.connect(url: url.absoluteString, token: token)
    }

    func publishCameraAndMicrophone() async throws {
        try await room.localParticipant.setCamera(enabled: true)
        try await room.localParticipant.setMicrophone(enabled: true)
    }

    func disconnect() async {
        await room.disconnect()
    }
}
