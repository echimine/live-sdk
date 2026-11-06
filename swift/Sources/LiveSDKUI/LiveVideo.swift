import LiveKit
import LiveSDK
import SwiftUI

struct HostVideo: View {
    let session: LiveSession

    var body: some View {
        if let room = session.mediaRoom, let hostId = session.host?.id {
            RoomHostVideo(room: room, hostId: hostId, isYou: session.role == .host)
        } else {
            Color.black
        }
    }
}

private struct RoomHostVideo: View {
    @ObservedObject var room: Room
    let hostId: String
    let isYou: Bool

    var body: some View {
        if isYou {
            ParticipantVideo(participant: room.localParticipant, mirrored: true)
        } else if let host = room.remoteParticipants[LiveKit.Participant.Identity(from: hostId)] {
            ParticipantVideo(participant: host, mirrored: false)
        } else {
            Color.black
        }
    }
}

private struct ParticipantVideo: View {
    @ObservedObject var participant: LiveKit.Participant
    let mirrored: Bool

    var body: some View {
        if let track = participant.firstCameraVideoTrack {
            SwiftUIVideoView(track, layoutMode: .fill, mirrorMode: mirrored ? .mirror : .off)
        } else {
            Color.black
        }
    }
}

struct CameraPreview: View {
    let track: LocalVideoTrack?

    var body: some View {
        if let track {
            SwiftUIVideoView(track, layoutMode: .fill, mirrorMode: .mirror)
        } else {
            Color.black
        }
    }
}

@MainActor
final class CameraPreviewController: ObservableObject {
    @Published private(set) var track: LocalVideoTrack?
    private var wanted = false

    func start() async {
        guard track == nil, !wanted else { return }
        wanted = true
        let camera = await LocalVideoTrack.createCameraTrack()
        try? await camera.start()
        guard wanted else {
            try? await camera.stop()
            return
        }
        track = camera
    }

    func stop() async {
        wanted = false
        let running = track
        track = nil
        try? await running?.stop()
    }
}
