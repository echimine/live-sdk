import Foundation
import ImageIO
import UniformTypeIdentifiers

public enum ProductImage: Sendable {
    case url(URL)
    case data(Data)
}

extension LiveSession {
    /// Épingle un produit. Une `.data` est réduite puis envoyée à `POST /v1/images` avant la commande ;
    /// un échec rend `invalidImage`, `payloadTooLarge`, `unsupportedMediaType`, `tokenUnavailable` ou `network`.
    public func pinProduct(name: String, price: Int, currency: String, image: ProductImage? = nil) async throws(LiveCommandError) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= config.product.nameMaxLength,
              (0...1_000_000).contains(price), currency.utf8.count == 3,
              currency.utf8.allSatisfy({ (65...90).contains($0) }) else {
            throw LiveCommandError(code: .invalidProduct, message: "Vérifiez le nom, le prix et la devise du produit.")
        }
        let imageURL: URL?
        switch image {
        case .url(let url):
            guard url.scheme == "https", url.host != nil else {
                throw LiveCommandError(code: .invalidProduct, message: "L’image doit utiliser une URL HTTPS.")
            }
            imageURL = url
        case .data(let data): imageURL = try await uploadProductImage(data)
        case nil: imageURL = nil
        }
        // Annulé pendant l'envoi de l'image : ne pas épingler pour autant.
        guard !Task.isCancelled else { throw LiveCommandError(code: .disconnected, message: "") }
        try await send(.pinProduct(name: name, price: price, currency: currency, imageUrl: imageURL))
    }

    public func unpinProduct() async throws(LiveCommandError) { try await send(.unpinProduct) }
    public func purchase(productId: String) async throws(LiveCommandError) { try await send(.purchase(productId: productId)) }
}

// ImageIO applique l’orientation et limite le plus grand côté sans décoder l’image entière.
enum ProductImageEncoder {
    static func jpeg(_ data: Data) throws(LiveCommandError) -> Data {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 1024
              ] as CFDictionary) else { throw invalidImage }
        let result = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(result, UTType.jpeg.identifier as CFString, 1, nil) else { throw invalidImage }
        CGImageDestinationAddImage(destination, thumbnail, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw invalidImage }
        return result as Data
    }

    static var invalidImage: LiveCommandError { .init(code: .invalidImage, message: "Image illisible : JPEG, PNG ou WebP attendu.") }
}
