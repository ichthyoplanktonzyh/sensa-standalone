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
        panel.prompt = "选择文件夹"
        panel.message = call.method == "chooseDestination"
          ? "选择保存 Sensa 连接工具的位置。将在其中创建新的专用文件夹。"
          : "选择此浏览器的 NativeMessagingHosts 文件夹。现有连接不会被覆盖。"
        panel.begin { response in
          guard response == .OK, let url = panel.url else { result(nil); return }
          if call.method == "chooseDestination" { self.destination = url }
          else { self.registration = url }
          result(url.path)
        }
      case "install":
        do { result(try self.install(call.arguments as? [String: Any] ?? [:])) }
        catch { result(FlutterError(code: "installation_failed", message: error.localizedDescription, details: nil)) }
      default: result(FlutterMethodNotImplemented)
      }
    }
  }

  private func invalid(_ message: String) -> NSError {
    NSError(domain: "SensaIntake", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }

  private func install(_ input: [String: Any]) throws -> [String: Any] {
    guard let root = destination,
          let libraryPath = input["libraryPath"] as? String,
          let libraryId = input["libraryId"] as? String,
          UUID(uuidString: libraryId) != nil,
          let label = input["label"] as? String, !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          label.count <= 100 else { throw invalid("请先选择连接文件夹并填写库名称。") }
    let ext = input["extensionId"] as? String ?? ""
    guard let browser = input["browser"] as? Bool else { throw invalid("请选择是否连接浏览器。") }
    if browser && (ext.count != 32 || !ext.allSatisfy({ "abcdefghijklmnop".contains($0) })) {
      throw invalid("扩展 ID 应为 Chrome 提供的 32 位小写字母。")
    }
    if browser && (registration == nil || registration!.lastPathComponent != "NativeMessagingHosts") {
      throw invalid("请选择浏览器的 NativeMessagingHosts 文件夹。")
    }
    let fm = FileManager.default
    // Only an existing library inside this application's support directory is eligible.
    let support = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).resolvingSymlinksInPath()
    let library = URL(fileURLWithPath: libraryPath).resolvingSymlinksInPath()
    guard library.path.hasPrefix(support.path + "/"), fm.fileExists(atPath: library.path) else {
      throw invalid("本机学习库不可用，请返回后重新读取。")
    }
    guard let executable = Bundle.main.executableURL else { throw invalid("找不到桌面接入工具。") }
    let helper = executable.deletingLastPathComponent().appendingPathComponent("sensa-intake")
    guard fm.isExecutableFile(atPath: helper.path) else { throw invalid("安装包未包含桌面接入工具，请更新 Sensa。") }
    let manifest = registration?.appendingPathComponent("app.sensa.intake.json")
    if browser && fm.fileExists(atPath: manifest!.path) { throw invalid("此浏览器已有连接，本次未覆盖。请先保留原连接并在需要时明确更换。") }
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
      throw invalid("未能写入连接。请检查所选文件夹的访问权限与可用空间，本次新建内容已清理。")
    }
  }

  private func write(_ value: [String: Any], to path: URL) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: path, options: [.withoutOverwriting])
    do { try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path) }
    catch { try? FileManager.default.removeItem(at: path); throw error }
  }
}
