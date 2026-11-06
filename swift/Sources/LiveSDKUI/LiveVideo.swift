import LiveKit
import LiveSDK
import SwiftUI

/// La scène en mosaïque portrait : l'Hôte en haut à gauche, puis les Co-hôtes par ordre de montée.
/// La room LiveKit est en `adaptiveStream` + simulcast : chaque tuile reçoit la qualité de sa taille.
struct StageVideo: View {
    let session: LiveSession

    private var onStage: [LiveParticipant] { Array(session.stage.prefix(StageMosaic.maxTiles)) }

    var body: some View {
        let mosaic = StageMosaic(count: onStage.count)
        GeometryReader { geometry in
            let width = geometry.size.width / CGFloat(mosaic.columns)
            let height = geometry.size.height / CGFloat(mosaic.rows)
            ZStack(alignment: .topLeading) {
                Color.black
                ForEach(Array(onStage.enumerated()), id: \.element.id) { index, participant in
                    let position = mosaic.position(of: index)
                    StageTile(session: session, participant: participant, showsName: mosaic.count > 1)
                        .frame(width: width, height: height)
                        .clipped()
                        .offset(x: CGFloat(position.column) * width, y: CGFloat(position.row) * height)
                }
            }
        }
        .animation(.easeInOut(duration: 0.25), value: onStage.map(\.id))
    }
}

private struct StageTile: View {
    let session: LiveSession
    let participant: LiveParticipant
    let showsName: Bool
    @Environment(\.liveTheme) private var theme

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            if let room = session.mediaRoom {
                RoomParticipantVideo(room: room, participant: participant, isYou: participant.id == session.you?.id)
            } else {
                TilePlaceholder(participant: participant)
            }
            if showsName {
                Text(participant.name)
                    .font(theme.font(12, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.black.opacity(0.45), in: Capsule())
                    .padding(8)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(participant.id == session.host?.id ? "\(participant.name), Hôte" : "\(participant.name), Co-hôte")
    }
}

private struct RoomParticipantVideo: View {
    @ObservedObject var room: Room
    let participant: LiveParticipant
    let isYou: Bool

    var body: some View {
        if isYou {
            ParticipantVideo(participant: room.localParticipant, mirrored: true, fallback: participant)
        } else if let remote = room.remoteParticipants[LiveKit.Participant.Identity(from: participant.id)] {
            ParticipantVideo(participant: remote, mirrored: false, fallback: participant)
        } else {
            TilePlaceholder(participant: participant)
        }
    }
}

private struct ParticipantVideo: View {
    @ObservedObject var participant: LiveKit.Participant
    let mirrored: Bool
    let fallback: LiveParticipant

    var body: some View {
        if let track = participant.firstCameraVideoTrack {
            SwiftUIVideoView(track, layoutMode: .fill, mirrorMode: mirrored ? .mirror : .off)
        } else {
            TilePlaceholder(participant: fallback)
        }
    }
}

private struct TilePlaceholder: View {
    let participant: LiveParticipant

    var body: some View {
        ZStack {
            Color.black
            ParticipantAvatar(participant: participant, size: 56)
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
