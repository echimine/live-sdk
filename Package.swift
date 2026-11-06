// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LiveSDK",
    platforms: [
        .iOS(.v17),
        // macOS uniquement pour lancer `swift test` sur l'hôte et en CI ; cible réelle : iOS 17+.
        .macOS(.v14),
    ],
    products: [
        .library(name: "LiveSDK", targets: ["LiveSDK"]),
        .library(name: "LiveSDKUI", targets: ["LiveSDKUI"]),
    ],
    targets: [
        .target(
            name: "LiveSDK",
            path: "swift/Sources/LiveSDK"
        ),
        .target(
            name: "LiveSDKUI",
            dependencies: ["LiveSDK"],
            path: "swift/Sources/LiveSDKUI"
        ),
        .testTarget(
            name: "LiveSDKTests",
            dependencies: ["LiveSDK"],
            path: "swift/Tests/LiveSDKTests"
        ),
    ]
)
