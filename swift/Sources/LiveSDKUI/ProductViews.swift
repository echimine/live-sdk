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

    var isValid: Bool {
        !id.isEmpty && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && name.count <= 80 &&
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
    let source: (any ProductSource)?
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Product?
    @State private var name = ""
    @State private var price = ""
    @State private var currency = "EUR"
    @State private var imageURL = ""
    @State private var cameraOpen = false
    @State private var cameraData: Data?
    @State private var photo: PhotosPickerItem?
    @State private var query = ""
    @State private var retry = 0
    @State private var suggestions: [ProductSuggestion] = []
    @State private var catalogueFailed = false
    @State private var searching = false
    @State private var busy = false
    @State private var error: String?
    private var animator: Bool { session.role == .host || session.role == .cohost }

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
                if let source {
                    Section("Catalogue") {
                        TextField("Rechercher un produit", text: $query)
                        if searching { ProgressView() }
                        if catalogueFailed {
                            Text("Catalogue indisponible")
                            Button("Réessayer") { retry += 1 }
                        }
                        ForEach(suggestions) { suggestion in
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
                    .task(id: SearchID(query: query, retry: retry)) { await search(source) }
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

    private struct SearchID: Hashable { let query: String; let retry: Int }

    private func search(_ source: any ProductSource) async {
        suggestions = []
        catalogueFailed = false
        searching = false
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
        searching = true
        // Deux tâches indépendantes : le timeout reste effectif même si la source ignore l’annulation.
        let request = Task { try await source.searchProducts(matching: query) }
        let timeout = Task { @MainActor in
            do { try await Task.sleep(for: .seconds(5)) } catch { return }
            request.cancel()
            searching = false
            catalogueFailed = true
        }
        await withTaskCancellationHandler {
            do {
                let results = try await request.value
                guard !Task.isCancelled, !timeout.isCancelled, !catalogueFailed else { return }
                var seen = Set<String>()
                suggestions = Array(results.filter { $0.isValid && seen.insert($0.id).inserted }.prefix(20))
            } catch {
                if !Task.isCancelled { catalogueFailed = true }
            }
            timeout.cancel()
            if !Task.isCancelled { searching = false }
        } onCancel: {
            request.cancel()
            timeout.cancel()
        }
    }

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
                guard let data = try await photo.loadTransferable(type: Data.self) else { throw ProductImageLoadError() }
                image = .data(data)
            } else if !imageURL.isEmpty {
                guard let url = URL(string: imageURL) else { throw ProductImageLoadError() }
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
            do { try await operation() } catch let command as LiveCommandError {
                error = command.code == .productChanged ? "Le produit a changé. Fermez cette fiche et ouvrez le nouveau produit avant de confirmer." : (command.message.isEmpty ? "Action impossible. Réessayez." : command.message)
            } catch { self.error = "Action impossible. Vérifiez l’image et la connexion, puis réessayez." }
        }
    }
}

private struct ProductImageLoadError: Error {}

struct PurchaseToast: View {
    let session: LiveSession
    @State private var message: ChatMessage?
    @State private var expiry: Task<Void, Never>?

    var body: some View {
        VStack {
            if let message { ChatMessageRow(message: message, onVideo: true).padding(12).background(.black.opacity(0.7), in: Capsule()) }
            Spacer()
        }
        .padding(.top, 80)
        .allowsHitTesting(false)
        .task(id: session.id) {
            for await event in session.events() {
                guard case .purchase(let purchase) = event else { continue }
                message = purchase
                expiry?.cancel()
                expiry = Task {
                    do { try await Task.sleep(for: .seconds(3)) } catch { return }
                    message = nil
                }
            }
            expiry?.cancel()
            message = nil
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
