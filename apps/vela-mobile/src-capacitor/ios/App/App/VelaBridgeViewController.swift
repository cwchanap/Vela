import Capacitor

final class VelaBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // Enable WKWebView's built-in back/forward swipe gestures so the native
        // edge-swipe history matches the app-owned chronological stack (HPA-209).
        webView?.allowsBackForwardNavigationGestures = true
    }
}
