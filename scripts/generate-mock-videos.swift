import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation

struct Palette {
    let top: (CGFloat, CGFloat, CGFloat)
    let bottom: (CGFloat, CGFloat, CGFloat)
    let accents: [(CGFloat, CGFloat, CGFloat)]
}

let palettes = [
    Palette(top: (0.06, 0.02, 0.19), bottom: (0.95, 0.15, 0.64), accents: [(0.15, 0.95, 0.87), (1.0, 0.76, 0.18), (0.55, 0.24, 1.0)]),
    Palette(top: (0.01, 0.12, 0.23), bottom: (0.10, 0.73, 0.91), accents: [(1.0, 0.31, 0.66), (0.52, 1.0, 0.43), (0.98, 0.88, 0.27)]),
    Palette(top: (0.14, 0.02, 0.04), bottom: (0.96, 0.42, 0.12), accents: [(0.98, 0.20, 0.67), (0.25, 0.70, 1.0), (1.0, 0.91, 0.36)]),
]

func color(_ components: (CGFloat, CGFloat, CGFloat), alpha: CGFloat = 1) -> CGColor {
    CGColor(red: components.0, green: components.1, blue: components.2, alpha: alpha)
}

func drawFrame(
    into pixelBuffer: CVPixelBuffer,
    width: Int,
    height: Int,
    phase: CGFloat,
    palette: Palette
) throws {
    CVPixelBufferLockBaseAddress(pixelBuffer, [])
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
    guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else {
        throw NSError(domain: "InfiniteSlopMock", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing pixel buffer address"])
    }
    guard let context = CGContext(
        data: baseAddress,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    ) else {
        throw NSError(domain: "InfiniteSlopMock", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not create drawing context"])
    }

    let bounds = CGRect(x: 0, y: 0, width: width, height: height)
    let gradient = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [color(palette.bottom), color(palette.top)] as CFArray,
        locations: [0, 1]
    )!
    context.drawLinearGradient(
        gradient,
        start: CGPoint(x: CGFloat(width) * (0.25 + 0.15 * sin(phase)), y: 0),
        end: CGPoint(x: CGFloat(width) * (0.75 + 0.15 * cos(phase)), y: CGFloat(height)),
        options: []
    )

    context.setBlendMode(.screen)
    for index in 0..<12 {
        let offset = CGFloat(index) * (.pi * 2 / 12)
        let radius = CGFloat(54 + (index % 4) * 17)
        let orbitX = CGFloat(width) * (0.26 + CGFloat(index % 3) * 0.035)
        let orbitY = CGFloat(height) * (0.25 + CGFloat(index % 4) * 0.025)
        let centerX = CGFloat(width) / 2 + cos(phase + offset) * orbitX
        let centerY = CGFloat(height) / 2 + sin(phase * (index.isMultiple(of: 2) ? 1 : -1) + offset) * orbitY
        context.setFillColor(color(palette.accents[index % palette.accents.count], alpha: 0.28))
        context.fillEllipse(in: CGRect(x: centerX - radius, y: centerY - radius, width: radius * 2, height: radius * 2))
    }

    context.setBlendMode(.overlay)
    context.setLineWidth(1)
    for index in 0..<18 {
        let y = CGFloat(index) * CGFloat(height) / 18 + sin(phase + CGFloat(index)) * 9
        context.setStrokeColor(CGColor(gray: 1, alpha: 0.11))
        context.move(to: CGPoint(x: 0, y: y))
        context.addLine(to: CGPoint(x: CGFloat(width), y: y + 28 * sin(phase * 2 + CGFloat(index))))
        context.strokePath()
    }

    context.setBlendMode(.normal)
    let vignette = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [CGColor(gray: 0, alpha: 0), CGColor(gray: 0, alpha: 0.58)] as CFArray,
        locations: [0.45, 1]
    )!
    context.drawRadialGradient(
        vignette,
        startCenter: CGPoint(x: CGFloat(width) / 2, y: CGFloat(height) / 2),
        startRadius: 10,
        endCenter: CGPoint(x: CGFloat(width) / 2, y: CGFloat(height) / 2),
        endRadius: CGFloat(height) * 0.62,
        options: [.drawsAfterEndLocation]
    )
    context.stroke(bounds.insetBy(dx: 4, dy: 4))
}

func generateVideo(at outputURL: URL, palette: Palette) async throws {
    let width = 360
    let height = 640
    let framesPerSecond: Int32 = 30
    let frameCount = Int(framesPerSecond) * 6

    try? FileManager.default.removeItem(at: outputURL)
    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: 480_000,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264MainAutoLevel,
            AVVideoMaxKeyFrameIntervalKey: Int(framesPerSecond),
        ],
    ])
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
    ])
    guard writer.canAdd(input) else {
        throw NSError(domain: "InfiniteSlopMock", code: 3, userInfo: [NSLocalizedDescriptionKey: "Cannot add video writer input"])
    }
    writer.add(input)
    guard writer.startWriting() else { throw writer.error ?? NSError(domain: "InfiniteSlopMock", code: 4) }
    writer.startSession(atSourceTime: .zero)

    for frame in 0..<frameCount {
        while !input.isReadyForMoreMediaData { try await Task.sleep(for: .milliseconds(2)) }
        guard let pool = adaptor.pixelBufferPool else {
            throw NSError(domain: "InfiniteSlopMock", code: 5, userInfo: [NSLocalizedDescriptionKey: "Missing pixel buffer pool"])
        }
        var optionalBuffer: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, pool, &optionalBuffer)
        guard let pixelBuffer = optionalBuffer else {
            throw NSError(domain: "InfiniteSlopMock", code: 6, userInfo: [NSLocalizedDescriptionKey: "Could not allocate a frame"])
        }
        let phase = CGFloat(frame) / CGFloat(frameCount) * .pi * 2
        try drawFrame(into: pixelBuffer, width: width, height: height, phase: phase, palette: palette)
        guard adaptor.append(pixelBuffer, withPresentationTime: CMTime(value: Int64(frame), timescale: framesPerSecond)) else {
            throw writer.error ?? NSError(domain: "InfiniteSlopMock", code: 7)
        }
    }
    input.markAsFinished()
    await writer.finishWriting()
    guard writer.status == .completed else { throw writer.error ?? NSError(domain: "InfiniteSlopMock", code: 8) }
}

@main
struct MockVideoGenerator {
    static func main() async throws {
        let outputDirectory = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "public/assets", isDirectory: true)
        try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
        for (index, palette) in palettes.enumerated() {
            let outputURL = outputDirectory.appendingPathComponent("mock-loop-\(index + 1).mp4")
            try await generateVideo(at: outputURL, palette: palette)
            let size = (try FileManager.default.attributesOfItem(atPath: outputURL.path)[.size] as? NSNumber)?.intValue ?? 0
            print("generated \(outputURL.lastPathComponent) \(size) bytes")
        }
    }
}
