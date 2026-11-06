import Foundation
import LiveKit

actor LiveKitMediaConnector: MediaConnector {
    private var room: Room?

    func connect(url: URL, token: String) async throws {
        let room = Room(roomOptions: RoomOptions(
            defaultVideoPublishOptions: VideoPublishOptions(simulcast: true),
            adaptiveStream: true,
            dynacast: true
        ))
        self.room = room
        try await room.connect(url: url.absoluteString, token: token)
    }

    func disconnect() async {
        await room?.disconnect()
        room = nil
    }
}
