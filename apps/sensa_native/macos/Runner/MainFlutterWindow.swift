import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  private var intakeInstaller: IntakeInstaller?
  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)
    intakeInstaller = IntakeInstaller(messenger: flutterViewController.engine.binaryMessenger)

    super.awakeFromNib()
  }
}

// The OS panel grants directory access to this process. No child is given the
// app's sandbox or credentials. The independent CLI still validates its pinned library.
private class IntakeInstaller {
  private let channel: FlutterMethodChannel
  private var destination: URL?
  private var registration: URL?

  init(messenger: FlutterBinaryMessenger) {
    channel = FlutterMethodChannel(name: "app.sensa/intake-install", binaryMessenger: messenger)
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else { return }
      switch call.method {
      case "chooseDestination", "chooseRegistration":
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        let labels = call.arguments as? [String: String] ?? [:]
        panel.prompt = labels["prompt"] ?? "Choose folder"
        panel.message = labels["message"]
        panel.begin { response in
          guard response == .OK, let url = panel.url else { result(nil); return }
          if call.method == "chooseDestination" { self.destination = url }
          else { self.registration = url }
          result(url.path)
        }
      case "install":
        do { result(try self.install(call.arguments as? [String: Any] ?? [:])) }
        catch { result(FlutterError(code: "installation_failed", message: error.localizedDescription, details: (error as NSError).userInfo["reason"] ?? "write_failed")) }
      default: result(FlutterMethodNotImplemented)
      }
    }
  }

  private func invalid(_ reason: String) -> NSError {
    NSError(domain: "SensaIntake", code: 1, userInfo: ["reason": reason])
  }

  private func install(_ input: [String: Any]) throws -> [String: Any] {
    guard let root = destination,
          let libraryPath = input["libraryPath"] as? String,
          let libraryId = input["libraryId"] as? String,
          UUID(uuidString: libraryId) != nil,
          let label = input["label"] as? String, !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          label.count <= 100 else { throw invalid("select_folder") }
    let ext = input["extensionId"] as? String ?? ""
    guard let browser = input["browser"] as? Bool else { throw invalid("select_browser") }
    if browser && (ext.count != 32 || !ext.allSatisfy({ "abcdefghijklmnop".contains($0) })) {
      throw invalid("extension_id")
    }
    if browser && (registration == nil || registration!.lastPathComponent != "NativeMessagingHosts") {
      throw invalid("registration_folder")
    }
    let fm = FileManager.default
    // Only an existing library inside this application's support directory is eligible.
    let support = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).resolvingSymlinksInPath()
    let library = URL(fileURLWithPath: libraryPath).resolvingSymlinksInPath()
    guard library.path.hasPrefix(support.path + "/"), fm.fileExists(atPath: library.path) else {
      throw invalid("library_unavailable")
    }
    guard let executable = Bundle.main.executableURL else { throw invalid("helper_missing") }
    let helper = executable.deletingLastPathComponent().appendingPathComponent("sensa-intake")
    guard fm.isExecutableFile(atPath: helper.path) else { throw invalid("helper_missing") }
    let manifest = registration?.appendingPathComponent("app.sensa.intake.json")
    if browser && fm.fileExists(atPath: manifest!.path) { throw invalid("already_connected") }
    let client = UUID().uuidString.lowercased()
    let folder = root.appendingPathComponent("Sensa-" + String(client.prefix(8)))
    try fm.createDirectory(at: folder, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    var registered = false
    do {
      let tool = folder.appendingPathComponent("sensa-intake")
      try fm.copyItem(at: helper, to: tool)
      try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: tool.path)
      let connection = folder.appendingPathComponent("connection.json")
      let config: [String: Any] = ["version": 1, "libraryPath": library.path, "libraryId": libraryId,
        "clientId": client, "label": label, "extensionId": ext]
      try write(config, to: connection)
      if browser {
        let config: [String: Any] = ["name": "app.sensa.intake", "description": "Sensa local library intake",
          "path": tool.path, "type": "stdio", "allowed_origins": ["chrome-extension://\(ext)/"]]
        try write(config, to: folder.appendingPathComponent("app.sensa.intake.json"))
        try write(config, to: manifest!)
        registered = true
      }
      return ["libraryId": libraryId, "clientId": client, "label": label,
        "connection": connection.path, "executable": tool.path, "browser": browser]
    } catch {
      if registered, let path = manifest { try? fm.removeItem(at: path) }
      try? fm.removeItem(at: folder)
      throw invalid("write_failed")
    }
  }

  private func write(_ value: [String: Any], to path: URL) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: path, options: [.withoutOverwriting])
    do { try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path) }
    catch { try? FileManager.default.removeItem(at: path); throw error }
  }
}
