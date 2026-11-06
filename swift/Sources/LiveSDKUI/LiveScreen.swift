import LiveSDK
import SwiftUI

public struct LiveScreen: View {
    private enum Source {
        case session(LiveSession)
        case id(String, LiveSDK)
    }

    private let source: Source
    private let onClose: () -> Void
    @State private var opened: LiveSession?
    @State private var openError: String?

    public init(session: LiveSession, onClose: @escaping () -> Void) {
        source = .session(session)
        self.onClose = onClose
    }

    public init(liveId: String, sdk: LiveSDK = .shared, onClose: @escaping () -> Void) {
        source = .id(liveId, sdk)
        self.onClose = onClose
    }

    public var body: some View {
        Group {
            if let session = currentSession {
                LiveStage(session: session, onClose: onClose)
            } else {
                ZStack {
                    Color.black.ignoresSafeArea()
                    if let openError {
                        Text(openError).foregroundStyle(.white)
                    } else {
                        ProgressView().tint(.white)
                    }
                    VStack {
                        HStack {
                            Spacer()
                            CloseButton(label: "Fermer", action: onClose)
                        }
                        Spacer()
                    }
                    .padding(16)
                }
            }
        }
        .task {
            guard case .id(let id, let sdk) = source, opened == nil else { return }
            do {
                let session = try await sdk.openLive(id: id)
                if Task.isCancelled {
                    await session.leave()
                } else {
                    opened = session
                }
            } catch {
                openError = error.displayMessage
            }
        }
        .onDisappear {
            guard let session = currentSession else { return }
            Task { await session.leave() }
        }
    }

    private var currentSession: LiveSession? {
        switch source {
        case .session(let session): session
        case .id: opened
        }
    }
}
