// Usage: swift scripts/md-to-pdf/html2pdf.swift <in.html> <out.pdf>
// Prints the page to a paginated A4 PDF with WebKit (macOS). See md2html.py for the full pipeline.
import Cocoa
import WebKit

final class Printer: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    let window: NSWindow
    let out: URL
    init(html: URL, out: URL) {
        let w: CGFloat = 595, h: CGFloat = 842
        self.out = out
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: w, height: h))
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: w, height: h), styleMask: [.borderless], backing: .buffered, defer: false)
        super.init()
        window.contentView = webView
        webView.navigationDelegate = self
        webView.loadFileURL(html, allowingReadAccessTo: html.deletingLastPathComponent())
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Let layout and fonts settle before printing.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.printPDF() }
    }
    func printPDF() {
        let info = NSPrintInfo()
        info.paperSize = NSSize(width: 595, height: 842) // A4 in points
        info.topMargin = 46; info.bottomMargin = 46; info.leftMargin = 44; info.rightMargin = 44
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.isHorizontallyCentered = false
        info.jobDisposition = .save
        info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = out
        let op = webView.printOperation(with: info)
        op.showsPrintPanel = false
        op.showsProgressPanel = false
        op.view?.frame = NSRect(x: 0, y: 0, width: 595 - 88, height: 842 - 92)
        op.runModal(for: window, delegate: self, didRun: #selector(printed(_:success:contextInfo:)), contextInfo: nil)
    }
    @objc func printed(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        print(success ? "saved \(out.path)" : "print failed")
        exit(success ? 0 : 1)
    }
}

let args = CommandLine.arguments
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let printer = Printer(html: URL(fileURLWithPath: args[1]), out: URL(fileURLWithPath: args[2]))
withExtendedLifetime(printer) { app.run() }
