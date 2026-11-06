import AVFoundation
#if canImport(UIKit)
import UIKit
#endif

public enum LivePermissionTexts {
    public static let camera = "La caméra sert à vous filmer pendant votre Live ou quand vous montez à l'écran. Rien n'est enregistré."
    public static let microphone = "Le micro sert à vous faire entendre pendant votre Live ou quand vous montez à l'écran. Rien n'est enregistré."
}

enum DevicePermission {
    static func isGranted(_ media: AVMediaType) -> Bool {
        AVCaptureDevice.authorizationStatus(for: media) == .authorized
    }

    static func wasDenied(_ media: AVMediaType) -> Bool {
        let status = AVCaptureDevice.authorizationStatus(for: media)
        return status == .denied || status == .restricted
    }

    @MainActor
    static func openSettings() {
        #if canImport(UIKit)
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
        #endif
    }

    static func request(_ media: AVMediaType) async -> Bool {
        await AVCaptureDevice.requestAccess(for: media)
    }
}
