import Foundation

struct LivesListResponse: Codable {
    let lives: [LiveSummary]
}

struct LivesCreateRequest: Codable {
    let title: String?
}

struct LivesCreateResponse: Codable {
    let live: LiveSummary
}

struct ImagesUploadResponse: Codable {
    let url: URL
}

struct HTTPErrorBody: Codable {
    struct Detail: Codable {
        let code: String
        let message: String
    }

    let error: Detail
}
