import Capacitor

final class VelaBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // capacitorDidLoad (not viewDidLoad) is the correct hook because the
        // webView property is still nil during viewDidLoad — Capacitor creates
        // the WKWebView later, so gesture configuration must wait until here.
        // Enable WKWebView's built-in back/forward swipe gestures so the native
        // edge-swipe history matches the app-owned chronological stack (HPA-209).
        webView?.allowsBackForwardNavigationGestures = true
    }
}
