import AVFoundation
import LiveSDK
import SwiftUI

public struct LiveLaunchScreen: View {
    private let sdk: LiveSDK
    private let onLaunched: (LiveSession) -> Void
    private let onClose: () -> Void

    @Environment(\.liveTheme) private var theme
    @StateObject private var preview = CameraPreviewController()
    @State private var camera = DevicePermission.isGranted(.video)
    @State private var microphone = DevicePermission.isGranted(.audio)
    @State private var askedOnce = false
    @State private var server = Check.pending
    @State private var serverAttempt = 0
    @State private var title = ""
    @State private var launching = false
    @State private var launchError: String?

    public init(sdk: LiveSDK = .shared, onLaunched: @escaping (LiveSession) -> Void, onClose: @escaping () -> Void) {
        self.sdk = sdk
        self.onLaunched = onLaunched
        self.onClose = onClose
    }

    private var ready: Bool {
        camera && microphone && server == .ok && !launching
    }

    public var body: some View {
        ZStack {
            CameraPreview(track: preview.track).ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Text(theme.label).font(theme.font(18, weight: .bold)).foregroundStyle(.white)
                    Spacer()
                    CloseButton(label: "Fermer") {
                        Task {
                            await preview.stop()
                            onClose()
                        }
                    }
                }
                Spacer()
                panel
            }
            .padding(16)
        }
        .background(Color.black)
        .font(theme.font(16))
        .tint(theme.accent)
        .task(id: camera) {
            if camera { await preview.start() }
        }
        .task(id: serverAttempt) {
            server = .pending
            do {
                _ = try await sdk.lives()
                server = .ok
            } catch {
                server = .failed(error.displayMessage)
            }
        }
        .onDisappear { Task { await preview.stop() } }
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 8) {
            CheckRow(label: "Caméra", check: camera ? .ok : .failed(LivePermissionTexts.camera))
            CheckRow(label: "Micro", check: microphone ? .ok : .failed(LivePermissionTexts.microphone))
            CheckRow(label: "Serveur", check: server)
            if !camera || !microphone {
                if DevicePermission.wasDenied(.video) || DevicePermission.wasDenied(.audio) {
                    Button("Ouvrir les Réglages", action: DevicePermission.openSettings)
                } else {
                    Button(askedOnce ? "Autoriser à nouveau" : "Autoriser la caméra et le micro") {
                        Task { await askPermissions() }
                    }
                }
            }
            if case .failed = server {
                Button("Réessayer la connexion") { serverAttempt += 1 }
            }
            TextField("Titre (facultatif)", text: $title)
                .textFieldStyle(.roundedBorder)
                .onChange(of: title) { _, typed in
                    let limited = LiveTitle.limited(typed)
                    if limited != typed { title = limited }
                }
            Text("\(LiveTitle.visibleLength(title)) / \(LiveTitle.maxLength)")
                .font(theme.font(12))
                .foregroundStyle(.white.opacity(0.7))
            if let launchError {
                Text(launchError).font(theme.font(13)).foregroundStyle(Color.errorText)
            }
            Button(action: launch) {
                Text(launching ? "Lancement…" : "Lancer")
                    .font(theme.font(17, weight: .bold))
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: theme.cornerRadius))
            .disabled(!ready)
        }
        .padding(16)
        .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: theme.cornerRadius))
    }

    private func askPermissions() async {
        camera = await DevicePermission.request(.video)
        microphone = await DevicePermission.request(.audio)
        askedOnce = true
    }

    private func launch() {
        launching = true
        launchError = nil
        Task {
            defer { launching = false }
            do {
                let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
                let live = try await sdk.startLive(title: trimmed.isEmpty ? nil : trimmed)
                await preview.stop()
                onLaunched(try await sdk.openLive(id: live.id))
            } catch {
                launchError = error.displayMessage
                if camera { await preview.start() }
            }
        }
    }
}

enum Check: Equatable {
    case pending
    case ok
    case failed(String)
}

private struct CheckRow: View {
    let label: String
    let check: Check

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            switch check {
            case .pending: Text("…").foregroundStyle(.white)
            case .ok: Text("✓").foregroundStyle(Color.okText)
            case .failed: Text("✕").foregroundStyle(Color.errorText)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(label).fontWeight(.semibold).foregroundStyle(.white)
                if case .failed(let reason) = check {
                    Text(reason).font(.caption).foregroundStyle(.white.opacity(0.75))
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

extension Color {
    static let errorText = Color(red: 1, green: 0.54, blue: 0.5)
    static let okText = Color(red: 0.41, green: 0.94, blue: 0.68)
}
