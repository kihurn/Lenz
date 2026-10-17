// lenz-ocr: reads a PNG on stdin, runs Apple Vision text recognition,
// prints one JSON line: {"text": "...", "confidence": 0.93, "coverage": 0.41}
import Foundation
import ImageIO
import Vision

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard !input.isEmpty,
      let source = CGImageSourceCreateWithData(input as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
else { fail("could not decode image from stdin") }

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }

do {
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
} catch {
    fail("vision failed: \(error.localizedDescription)")
}

// Vision's origin is bottom-left; sort top-to-bottom, then left-to-right.
let observations = (request.results ?? []).sorted {
    abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.01
        ? $0.boundingBox.midY > $1.boundingBox.midY
        : $0.boundingBox.minX < $1.boundingBox.minX
}

var lines: [String] = []
var confidenceSum: Float = 0
var area: CGFloat = 0
for obs in observations {
    guard let best = obs.topCandidates(1).first else { continue }
    lines.append(best.string)
    confidenceSum += best.confidence
    area += obs.boundingBox.width * obs.boundingBox.height
}

let result: [String: Any] = [
    "text": lines.joined(separator: "\n"),
    "confidence": lines.isEmpty ? 0 : Double(confidenceSum) / Double(lines.count),
    "coverage": min(1.0, Double(area))
]
let json = try! JSONSerialization.data(withJSONObject: result)
FileHandle.standardOutput.write(json)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
