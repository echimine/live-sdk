import Foundation

struct URLSessionHTTPTransport: HTTPTransport {
    let session: URLSession

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        var urlRequest = URLRequest(url: request.url)
        urlRequest.httpMethod = request.method
        urlRequest.httpBody = request.body
        urlRequest.cachePolicy = .reloadIgnoringLocalCacheData
        request.headers.forEach { urlRequest.setValue($0.value, forHTTPHeaderField: $0.key) }
        let (data, response) = try await session.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        let headers = http.allHeaderFields.reduce(into: [String: String]()) { headers, field in
            if let name = field.key as? String, let value = field.value as? String {
                headers[name] = value
            }
        }
        return HTTPResponse(status: http.statusCode, headers: headers, body: data)
    }
}
