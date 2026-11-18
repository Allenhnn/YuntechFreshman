// Text recognition for the scanned floor plans with Apple's Vision framework (built into macOS,
// no install). Prints one JSON line per image: recognised strings with their pixel boxes.
//
//   swiftc -O scripts/floorplan/ocr.swift -o scripts/floorplan/.ocr
//   scripts/floorplan/.ocr a.jpg b.jpg ... > out.jsonl
//
// Box: [x, y, w, h] in image pixels, origin top-left (Vision's normalised bottom-left is converted).
import Foundation
import Vision
import ImageIO

struct Line: Encodable { let text: String; let conf: Float; let box: [Double] }
struct Page: Encodable { let file: String; let width: Int; let height: Int; let lines: [Line] }

let encoder = JSONEncoder()
for path in CommandLine.arguments.dropFirst() {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    FileHandle.standardError.write("cannot read \(path)\n".data(using: .utf8)!)
    continue
  }
  let w = Double(image.width), h = Double(image.height)
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["zh-Hant", "en-US"]
  request.usesLanguageCorrection = false // room codes like "105b" must stay as drawn
  request.minimumTextHeight = 0.004
  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  try? handler.perform([request])
  var lines: [Line] = []
  for obs in request.results ?? [] {
    guard let best = obs.topCandidates(1).first else { continue }
    let b = obs.boundingBox
    lines.append(Line(text: best.string, conf: best.confidence,
                      box: [b.minX * w, (1 - b.maxY) * h, b.width * w, b.height * h].map { ($0 * 10).rounded() / 10 }))
  }
  let page = Page(file: path, width: image.width, height: image.height, lines: lines)
  if let data = try? encoder.encode(page), let s = String(data: data, encoding: .utf8) { print(s) }
}
