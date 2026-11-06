import Foundation
import LiveSDK
import PhotosUI
import SwiftUI
#if os(iOS)
import UIKit
#endif

public protocol ProductSource: Sendable {
    func searchProducts(matching query: String) async throws -> [ProductSuggestion]
}

public struct ProductSuggestion: Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let priceCents: Int
    public let currency: String
    public let imageURL: URL?

    public init(id: String, name: String, priceCents: Int, currency: String, imageURL: URL? = nil) {
        self.id = id
        self.name = name
        self.priceCents = priceCents
        self.currency = currency
        self.imageURL = imageURL
    }

    /// Ce que le serveur commun accepterait : nom de 1 à `config.product.nameMaxLength` caractères visibles,
    /// prix de 0 à 1 000 000 centimes, devise ISO, image https. Un `id` vide ne peut pas être dédoublonné.
    func isValid(in config: LiveConfig) -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return !id.isEmpty && !trimmed.isEmpty && trimmed.count <= config.product.nameMaxLength &&
        (0...1_000_000).contains(priceCents) && currency.utf8.count == 3 && currency.utf8.allSatisfy { (65...90).contains($0) } &&
        (imageURL == nil || (imageURL?.scheme == "https" && imageURL?.host != nil))
    }
}

private struct ProductSourceKey: EnvironmentKey {
    static let defaultValue: (any ProductSource)? = nil
}

extension EnvironmentValues {
    public var productSource: (any ProductSource)? {
        get { self[ProductSourceKey.self] }
        set { self[ProductSourceKey.self] = newValue }
    }
}

extension View {
    public func productSource(_ source: any ProductSource) -> some View { environment(\.productSource, source) }
}

struct ProductSheet: View {
    let session: LiveSession
    @Environment(\.dismiss) private var dismiss
    @State private var search: ProductSearch?
    @State private var selected: Product?
    @State private var name = ""
    @State private var price = ""
    @State private var currency = "EUR"
    @State private var imageURL = ""
    @State private var cameraOpen = false
    @State private var cameraData: Data?
    @State private var photo: PhotosPickerItem?
    @State private var query = ""
    @State private var busy = false
    @State private var error: String?
    private var animator: Bool { session.role == .host || session.role == .cohost }

    init(session: LiveSession, source: (any ProductSource)?) {
        self.session = session
        _search = State(initialValue: source.map { ProductSearch(source: $0, config: session.config) })
    }

    var body: some View {
        Form {
            if let product = selected {
                Section {
                    if let url = product.imageUrl {
                        AsyncImage(url: url) { image in image.resizable().scaledToFit() } placeholder: { ProgressView() }
                            .frame(maxHeight: 180)
                    }
                    Text(product.name)
                    Text(PriceText.format(cents: product.price, currency: product.currency))
                    Text("Achat simulé : aucun paiement.").foregroundStyle(.secondary)
                    Button("Confirmer l’achat") { run { try await session.purchase(productId: product.id); dismiss() } }
                        .disabled(busy || session.status != .connected)
                }
            } else if !animator {
                Text("Aucun produit épinglé.")
            }
            if animator {
                if let search {
                    Section("Catalogue") {
                        TextField("Rechercher un produit", text: $query)
                        if search.searching { ProgressView() }
                        if search.failed {
                            Text("Catalogue indisponible")
                            Button("Réessayer") { search.retry() }
                        }
                        ForEach(search.suggestions) { suggestion in
                            Button {
                                name = suggestion.name
                                price = NSDecimalNumber(decimal: Decimal(suggestion.priceCents) / 100).description(withLocale: Locale.current)
                                currency = suggestion.currency
                                imageURL = suggestion.imageURL?.absoluteString ?? ""
                                photo = nil
                                cameraData = nil
                            } label: {
                                Text("\(suggestion.name) · \(PriceText.format(cents: suggestion.priceCents, currency: suggestion.currency))")
                            }
                        }
                    }
                    .onChange(of: query) { _, typed in search.search(typed) }
                    .onDisappear { search.cancel() }
                }
                Section("Saisie manuelle") {
                    TextField("Nom", text: $name)
                    TextField("Prix", text: $price)
                    TextField("Devise (EUR, USD…)", text: $currency)
                    TextField("URL HTTPS de l’image", text: $imageURL)
                    PhotosPicker(selection: $photo, matching: .images) { Text(photo == nil ? "Choisir une photo" : "Photo sélectionnée") }
                    #if os(iOS)
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button(cameraData == nil ? "Prendre une photo" : "Photo prise") { cameraOpen = true }
                    }
                    #endif
                    Button("Épingler le produit") { pin() }.disabled(busy || session.status != .connected)
                    if session.pinnedProduct != nil {
                        Button("Retirer le produit", role: .destructive) { run { try await session.unpinProduct(); dismiss() } }
                            .disabled(busy || session.status != .connected)
                    }
                }
            }
            if let error { Text(error).foregroundStyle(.red) }
        }
        .navigationTitle("Produit épinglé")
        .toolbar { Button("Fermer") { dismiss() } }
        .onChange(of: photo) { _, value in if value != nil { cameraData = nil } }
        #if os(iOS)
        .sheet(isPresented: $cameraOpen) {
            ProductCamera { data in
                photo = nil
                cameraData = data
                cameraOpen = false
            }
        }
        #endif
        .onAppear {
            selected = session.pinnedProduct
            if let product = selected, animator {
                name = product.name
                price = NSDecimalNumber(decimal: Decimal(product.price) / 100).description(withLocale: Locale.current)
                currency = product.currency
                imageURL = product.imageUrl?.absoluteString ?? ""
            }
        }
    }

    /// Photo choisie ou URL saisie illisible, avant tout envoi.
    private static let unreadableImage = LiveCommandError(code: .invalidImage, message: "Image illisible. Choisissez une autre photo ou vérifiez l’URL.")

    private func pin() {
        guard let decimal = Decimal(string: price, locale: .current), decimal >= 0, decimal <= 10_000 else {
            error = "Saisissez un prix entre 0 et 10 000."
            return
        }
        let cents = decimal * 100
        guard Decimal(NSDecimalNumber(decimal: cents).intValue) == cents else { error = "Le prix accepte deux décimales."; return }
        let amount = NSDecimalNumber(decimal: cents).intValue
        run {
            let image: ProductImage?
            if let cameraData {
                image = .data(cameraData)
            } else if let photo {
                guard let data = try await photo.loadTransferable(type: Data.self) else { throw Self.unreadableImage }
                image = .data(data)
            } else if !imageURL.isEmpty {
                guard let url = URL(string: imageURL) else { throw Self.unreadableImage }
                image = .url(url)
            } else { image = nil }
            try await session.pinProduct(name: name, price: amount, currency: currency, image: image)
            dismiss()
        }
    }

    private func run(_ operation: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do { try await operation() } catch { self.error = error.displayMessage }
        }
    }
}



/// Toast en haut de l'écran : Annonces d'achat et refus d'une Demande de montée, quelques secondes chacun.
struct LiveToast: View {
    let session: LiveSession
    @State private var shown: Content?
    @State private var expiry: Task<Void, Never>?

    enum Content: Equatable {
        case purchase(ChatMessage)
        case joinDeclined

        init?(_ event: LiveEvent) {
            switch event {
            case .purchase(let message): self = .purchase(message)
            case .joinDeclined: self = .joinDeclined
            case .reactions: return nil
            }
        }
    }

    var body: some View {
        VStack {
            if let shown {
                Group {
                    switch shown {
                    case .purchase(let message): ChatMessageRow(message: message, onVideo: true)
                    case .joinDeclined: Text("✋ L'Hôte n'a pas retenu votre Demande de montée.").foregroundStyle(.white)
                    }
                }
                .padding(12)
                .background(.black.opacity(0.7), in: Capsule())
            }
            Spacer()
        }
        .padding(.top, 80)
        .allowsHitTesting(false)
        .task(id: session.id) {
            for await event in session.events() {
                guard let content = Content(event) else { continue }
                shown = content
                expiry?.cancel()
                expiry = Task {
                    do { try await Task.sleep(for: .seconds(3)) } catch { return }
                    shown = nil
                }
            }
            expiry?.cancel()
            shown = nil
        }
    }
}

#if os(iOS)
private struct ProductCamera: UIViewControllerRepresentable {
    let onFinish: (Data?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onFinish: (Data?) -> Void
        init(onFinish: @escaping (Data?) -> Void) { self.onFinish = onFinish }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onFinish(nil) }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onFinish((info[.originalImage] as? UIImage)?.jpegData(compressionQuality: 0.95))
        }
    }
}
#endif
