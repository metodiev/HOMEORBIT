import UIKit
import Capacitor

@objc(HomeOrbitServerPlugin)
public class HomeOrbitServerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HomeOrbitServerPlugin"
    public let jsName = "HomeOrbitServer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reload", returnType: CAPPluginReturnPromise)
    ]

    static let serverKey = "homeorbit_server_url"

    static func clearSavedServer() {
        UserDefaults.standard.removeObject(forKey: serverKey)
    }

    static func isSetupURL(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "homeorbit" && url.host == "setup"
    }

    private func normalized(_ raw: String?) -> String? {
        guard let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        guard value.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { return nil }
        guard var components = URLComponents(string: value) else { return nil }
        let scheme = components.scheme?.lowercased()
        guard scheme == "https" || scheme == "http" else { return nil }
        guard let host = components.host, !host.isEmpty else { return nil }
        guard components.user == nil, components.password == nil else { return nil }
        let path = components.path
        guard path.isEmpty || path == "/" else { return nil }
        guard components.query == nil, components.fragment == nil else { return nil }
        components.scheme = scheme
        components.path = ""
        return components.string
    }

    @objc func get(_ call: CAPPluginCall) {
        if let server = UserDefaults.standard.string(forKey: Self.serverKey) {
            call.resolve(["url": server])
        } else {
            call.resolve(["url": NSNull()])
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let server = normalized(call.getString("url")) else {
            call.reject("Enter a valid http(s) HomeOrbit root address without a path.")
            return
        }
        UserDefaults.standard.set(server, forKey: Self.serverKey)
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        Self.clearSavedServer()
        call.resolve()
    }

    @objc func reload(_ call: CAPPluginCall) {
        call.resolve()
        DispatchQueue.main.async {
            guard let window = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap({ $0.windows })
                .first(where: { $0.isKeyWindow }) else { return }
            window.rootViewController = HomeOrbitBridgeViewController()
            window.makeKeyAndVisible()
        }
    }
}

final class HomeOrbitBridgeViewController: CAPBridgeViewController {
    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        descriptor.errorPath = "offline.html"
        if let server = UserDefaults.standard.string(forKey: HomeOrbitServerPlugin.serverKey),
           let url = URL(string: server),
           let host = url.host {
            descriptor.serverURL = server
            descriptor.allowedNavigationHostnames = [host]
        }
        return descriptor
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        if let bridge = bridge as? CapacitorBridge {
            bridge.registerPluginInstance(HomeOrbitServerPlugin())
        }
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        if connectionOptions.urlContexts.contains(where: { HomeOrbitServerPlugin.isSetupURL($0.url) }) {
            HomeOrbitServerPlugin.clearSavedServer()
        }
        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = HomeOrbitBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if URLContexts.contains(where: { HomeOrbitServerPlugin.isSetupURL($0.url) }) {
            HomeOrbitServerPlugin.clearSavedServer()
            window?.rootViewController = HomeOrbitBridgeViewController()
            window?.makeKeyAndVisible()
        }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
