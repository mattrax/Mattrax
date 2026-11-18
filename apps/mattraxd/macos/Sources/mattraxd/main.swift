// mattraxd (macOS): the Mattrax on-device daemon.
//
// Reads `com.mattrax.script` payloads from the installed configuration
// profiles, evaluates their triggers and posts one result per run to the
// Mattrax script-result endpoint.
//
// Build: see apps/mattraxd/README.md. Install: a signed, notarized .pkg or the
// LaunchDaemon plist in macos/Resources with the binary at
// /usr/local/libexec/mattraxd.

import Foundation
import Security

#if os(macOS)
  import Darwin
#endif

let agentVersion = "1.0.0"
let statePath = "/var/lib/mattrax/mattraxd-state.json"
let logPath = "/var/log/mattraxd.log"
let scriptPayloadType = "com.mattrax.script"
let outputLimit = 64 * 1024

// MARK: - Models

struct EnvironmentEntry: Codable {
  let name: String
  let value: String
  let secret: Bool
}

struct Trigger: Codable {
  let type: String
  let intervalSeconds: Int?
  let cronExpression: String?
}

struct InstalledScript {
  let id: String
  let name: String
  let language: String
  let body: String
  let runAs: String
  let timeoutSeconds: Int
  let environment: [EnvironmentEntry]
  let trigger: Trigger
  let runId: String?
  let serverUrl: String
  let deviceToken: String
}

struct ScriptState: Codable {
  var digest: String = ""
  var lastRun: [String: Double] = [:]
  var lastMinute: [String: Int] = [:]
  var executedRuns: [String] = []
}

struct AgentState: Codable {
  var scripts: [String: ScriptState] = [:]
  var lastBoot: String = ""
  var lastConsoleUser: String = ""
  var lastNetworkHash: String = ""
}

struct ScriptResult: Codable {
  let runId: String
  let scriptId: String
  let trigger: String
  let exitCode: Int?
  let stdout: String
  let stderr: String
  let durationMs: Int
  let startedAt: String
  let finishedAt: String
  let detail: String?
  let timedOut: Bool
}

// MARK: - Utilities

func log(_ message: String) {
  let line = "[\(ISO8601DateFormatter().string(from: Date()))] \(message)\n"

  FileHandle.standardError.write(Data(line.utf8))

  if let handle = FileHandle(forWritingAtPath: logPath) {
    handle.seekToEndOfFile()
    handle.write(Data(line.utf8))
    try? handle.close()
  } else {
    FileManager.default.createFile(atPath: logPath, contents: Data(line.utf8))
  }
}

func runProcess(_ path: String, _ arguments: [String], stdin: Data? = nil)
  -> (status: Int, stdout: Data, stderr: Data)
{
  let process = Process()
  process.executableURL = URL(fileURLWithPath: path)
  process.arguments = arguments

  let out = Pipe()
  let err = Pipe()
  let input = Pipe()

  process.standardOutput = out
  process.standardError = err

  if stdin != nil { process.standardInput = input }

  do {
    try process.run()
  } catch {
    return (-1, Data(), Data("failed to start \(path): \(error)".utf8))
  }

  if let stdin {
    input.fileHandleForWriting.write(stdin)
    try? input.fileHandleForWriting.close()
  }

  // Drain both pipes concurrently. Reading stdout to EOF before touching
  // stderr deadlocks when the child fills the stderr pipe first.
  let drained = DispatchGroup()
  var stdout = Data()
  var stderr = Data()

  drained.enter()
  DispatchQueue.global().async {
    stdout = out.fileHandleForReading.readDataToEndOfFile()
    drained.leave()
  }

  drained.enter()
  DispatchQueue.global().async {
    stderr = err.fileHandleForReading.readDataToEndOfFile()
    drained.leave()
  }

  drained.wait()
  process.waitUntilExit()

  return (Int(process.terminationStatus), stdout, stderr)
}

func randomHex(_ count: Int) -> String {
  var bytes = [UInt8](repeating: 0, count: count)
  _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)

  return bytes.map { String(format: "%02x", $0) }.joined()
}

// MARK: - State

func loadState() -> AgentState {
  guard let data = FileManager.default.contents(atPath: statePath) else { return AgentState() }

  return (try? JSONDecoder().decode(AgentState.self, from: data)) ?? AgentState()
}

func saveState(_ state: AgentState) {
  let directory = (statePath as NSString).deletingLastPathComponent

  try? FileManager.default.createDirectory(
    atPath: directory, withIntermediateDirectories: true, attributes: nil)

  if let data = try? JSONEncoder().encode(state) {
    try? data.write(to: URL(fileURLWithPath: statePath), options: [.atomic])
  }
}

// MARK: - Profiles

func installedProfileIdentifiers() -> [String] {
  let result = runProcess("/usr/bin/profiles", ["-P", "-o", "stdout-xml"])

  guard result.status == 0,
    let plist = try? PropertyListSerialization.propertyList(
      from: result.stdout, options: [], format: nil) as? [String: Any],
    let profiles = plist["_computerlevel"] as? [[String: Any]]
  else { return [] }

  return profiles.compactMap { $0["ProfileIdentifier"] as? String }
}

func profileContents(_ identifier: String) -> [String: Any]? {
  let result = runProcess("/usr/bin/profiles", ["-P", "-p", identifier, "-o", "stdout-xml"])

  guard result.status == 0 else { return nil }

  return (try? PropertyListSerialization.propertyList(
    from: result.stdout, options: [], format: nil) as? [String: Any])
}

func installedScripts() -> [InstalledScript] {
  var scripts: [InstalledScript] = []

  for identifier in installedProfileIdentifiers() {
    guard let profile = profileContents(identifier),
      let payloads = profile["PayloadContent"] as? [[String: Any]]
    else { continue }

    for payload in payloads where payload["PayloadType"] as? String == scriptPayloadType {
      guard let scriptId = payload["ScriptID"] as? String,
        let body = payload["Content"] as? String,
        let serverUrl = payload["ServerURL"] as? String,
        let deviceToken = payload["DeviceToken"] as? String
      else { continue }

      let triggerType = (payload["Triggers"] as? [[String: Any]])?.first?["Type"] as? String
      let interval = (payload["Triggers"] as? [[String: Any]])?.first?["TimerInterval"] as? Int
      let cron = (payload["Triggers"] as? [[String: Any]])?.first?["CronExpression"] as? String
      let flaggedSecrets = Set(payload["SecretEnvironment"] as? [String] ?? [])
      let environment =
        (payload["Environment"] as? [String: String])?.map { name, value in
          EnvironmentEntry(
            name: name, value: value,
            secret: flaggedSecrets.contains(name)
              || name.uppercased().contains("SECRET")
              || name.uppercased().contains("TOKEN")
              || name.uppercased().contains("PASSWORD"))
        } ?? []

      scripts.append(
        InstalledScript(
          id: scriptId,
          name: payload["PayloadDisplayName"] as? String ?? scriptId,
          language: payload["Shell"] as? String ?? "sh",
          body: body,
          runAs: payload["Permission"] as? String ?? "user",
          timeoutSeconds: payload["Timeout"] as? Int ?? 300,
          environment: environment,
          trigger: Trigger(
            type: triggerType ?? "install", intervalSeconds: interval, cronExpression: cron),
          runId: (payload["RunID"] as? String).flatMap { $0.isEmpty ? nil : $0 },
          serverUrl: serverUrl,
          deviceToken: deviceToken))
    }
  }

  return scripts
}

// MARK: - Host context

func bootTime() -> String {
  let result = runProcess("/usr/sbin/sysctl", ["-n", "kern.boottime"])

  return String(data: result.stdout, encoding: .utf8) ?? ""
}

func consoleUser() -> String {
  let result = runProcess("/usr/bin/stat", ["-f", "%Su", "/dev/console"])
  let name = (String(data: result.stdout, encoding: .utf8) ?? "").trimmingCharacters(
    in: .whitespacesAndNewlines)

  return name == "root" || name == "loginwindow" ? "" : name
}

func consoleUid(_ name: String) -> uid_t? {
  guard !name.isEmpty else { return nil }

  let result = runProcess("/usr/bin/id", ["-u", name])

  return uid_t((String(data: result.stdout, encoding: .utf8) ?? "").trimmingCharacters(
    in: .whitespacesAndNewlines))
}

func networkHash() -> String {
  let result = runProcess("/sbin/ifconfig", [])
  var hash: UInt64 = 1469598103934665603

  for byte in result.stdout {
    hash = (hash ^ UInt64(byte)) &* 1099511628211
  }

  return String(hash, radix: 16)
}

func scriptDigest(_ script: InstalledScript) -> String {
  var hash: UInt64 = 1469598103934665603
  let environment = script.environment
    .map { "\($0.name)=\($0.value)=\($0.secret)" }
    .joined(separator: "\u{1e}")
  let source =
    [script.id, script.language, script.body, script.runAs, String(script.timeoutSeconds),
      script.trigger.type, String(script.trigger.intervalSeconds ?? 0),
      script.trigger.cronExpression ?? "", script.serverUrl, script.deviceToken,
      environment].joined(separator: "\u{1f}")

  for byte in Data(source.utf8) {
    hash = (hash ^ UInt64(byte)) &* 1099511628211
  }

  return String(hash, radix: 16)
}

// MARK: - Cron

func cronField(_ field: String, _ value: Int) -> Bool {
  for part in field.split(separator: ",") {
    let pieces = part.split(separator: "/", maxSplits: 1)
    let range = String(pieces[0])
    let step = pieces.count > 1 ? Int(pieces[1]) ?? 1 : 1

    if range == "*" {
      if value % step == 0 { return true }
      continue
    }

    let bounds = range.split(separator: "-").compactMap { Int($0) }

    if bounds.count == 2, value >= bounds[0], value <= bounds[1],
      (value - bounds[0]) % step == 0
    {
      return true
    }

    if bounds.count == 1, value == bounds[0] { return true }
  }

  return false
}

func cronMatches(_ expression: String?, _ date: Date) -> Bool {
  guard let expression else { return false }
  let fields = expression.split(separator: " ").map(String.init)

  if fields.count != 5 { return false }

  let calendar = Calendar(identifier: .gregorian)
  let components = calendar.dateComponents([.minute, .hour, .day, .month, .weekday], from: date)
  // Calendar counts 1=Sunday…7=Saturday; cron counts 0=Sunday…6=Saturday.
  let weekday = (components.weekday ?? 1) - 1

  return cronField(fields[0], components.minute ?? 0)
    && cronField(fields[1], components.hour ?? 0)
    && cronField(fields[2], components.day ?? 1)
    && cronField(fields[3], components.month ?? 1)
    && cronField(fields[4], weekday)
}

// MARK: - Execution

func capped(_ data: Data) -> (String, Bool) {
  if data.count <= outputLimit { return (String(decoding: data, as: UTF8.self), false) }

  let text = String(decoding: data.prefix(outputLimit), as: UTF8.self)

  return (text + "\n[mattrax: output truncated]", true)
}

func redact(_ value: String, secrets: [String]) -> String {
  var text = value

  for secret in secrets where !secret.isEmpty {
    text = text.replacingOccurrences(of: secret, with: "[redacted]")
  }

  return text
}

func execute(_ script: InstalledScript, trigger: String) -> ScriptResult {
  let startedAt = Date()
  let secrets = script.environment.filter(\.secret).map(\.value)

  guard script.runAs != "root" || geteuid() == 0 else {
    return ScriptResult(
      runId: script.runId ?? "trigger-\(randomHex(8))", scriptId: script.id, trigger: trigger,
      exitCode: nil, stdout: "", stderr: "",
      durationMs: 0, startedAt: ISO8601DateFormatter().string(from: startedAt),
      finishedAt: ISO8601DateFormatter().string(from: Date()),
      detail: "The agent is not running as root, so a root script cannot run.", timedOut: false)
  }

  guard ["bash", "zsh", "sh"].contains(script.language) else {
    return ScriptResult(
      runId: script.runId ?? "trigger-\(randomHex(8))", scriptId: script.id, trigger: trigger,
      exitCode: nil, stdout: "", stderr: "",
      durationMs: 0, startedAt: ISO8601DateFormatter().string(from: startedAt),
      finishedAt: ISO8601DateFormatter().string(from: Date()),
      detail: "The macOS agent cannot run '\(script.language)' scripts; use bash, zsh or sh.",
      timedOut: false)
  }

  let shell = "/bin/" + script.language
  var path = shell
  var arguments = ["-c", script.body]

  if script.runAs != "root" {
    guard let user = Optional(consoleUser()), !user.isEmpty, let uid = consoleUid(user) else {
      return ScriptResult(
        runId: script.runId ?? "trigger-\(randomHex(8))", scriptId: script.id, trigger: trigger,
        exitCode: nil, stdout: "", stderr: "",
        durationMs: 0, startedAt: ISO8601DateFormatter().string(from: startedAt),
        finishedAt: ISO8601DateFormatter().string(from: Date()),
        detail: "No console user is logged in, so a user script cannot run.", timedOut: false)
    }

    path = "/bin/launchctl"
    arguments = ["asuser", String(uid), shell, "-c", script.body]
  }

  let process = Process()
  process.executableURL = URL(fileURLWithPath: path)
  process.arguments = arguments

  var environment = ProcessInfo.processInfo.environment

  for entry in script.environment { environment[entry.name] = entry.value }

  environment["MATTRAX_TRIGGER_TYPE"] = trigger
  environment["MATTRAX_SCRIPT_ID"] = script.id
  process.environment = environment

  let stdoutPipe = Pipe()
  let stderrPipe = Pipe()
  var stdout = Data()
  var stderr = Data()

  process.standardOutput = stdoutPipe
  process.standardError = stderrPipe

  stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
    let data = handle.availableData

    if !data.isEmpty, stdout.count < outputLimit { stdout.append(data) }
  }

  stderrPipe.fileHandleForReading.readabilityHandler = { handle in
    let data = handle.availableData

    if !data.isEmpty, stderr.count < outputLimit { stderr.append(data) }
  }

  var timedOut = false

  do {
    try process.run()
  } catch {
    return ScriptResult(
      runId: script.runId ?? "trigger-\(randomHex(8))", scriptId: script.id, trigger: trigger,
      exitCode: nil, stdout: "", stderr: "", durationMs: 0,
      startedAt: ISO8601DateFormatter().string(from: startedAt),
      finishedAt: ISO8601DateFormatter().string(from: Date()),
      detail: "The shell could not be started: \(error)", timedOut: false)
  }

  let deadline = DispatchTime.now() + .seconds(max(1, script.timeoutSeconds))

  DispatchQueue.global().asyncAfter(deadline: deadline) {
    if process.isRunning {
      timedOut = true
      process.terminate()
    }
  }

  process.waitUntilExit()
  stdoutPipe.fileHandleForReading.readabilityHandler = nil
  stderrPipe.fileHandleForReading.readabilityHandler = nil
  stdout.append(stdoutPipe.fileHandleForReading.availableData)
  stderr.append(stderrPipe.fileHandleForReading.availableData)

  let (out, _) = capped(stdout)
  let (err, _) = capped(stderr)
  let duration = Int(Date().timeIntervalSince(startedAt) * 1000)

  return ScriptResult(
    runId: script.runId ?? "trigger-\(randomHex(8))", scriptId: script.id, trigger: trigger,
    exitCode: Int(process.terminationStatus), stdout: redact(out, secrets: secrets),
    stderr: redact(err, secrets: secrets), durationMs: duration,
    startedAt: ISO8601DateFormatter().string(from: startedAt),
    finishedAt: ISO8601DateFormatter().string(from: Date()),
    detail: timedOut ? "The script exceeded its timeout and was stopped." : nil,
    timedOut: timedOut)
}

func post(_ result: ScriptResult, script: InstalledScript) {
  guard let data = try? JSONEncoder().encode(result) else { return }

  let endpoint = script.serverUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    + "/v1/script-agent/results"

  let resultProcess = Process()
  resultProcess.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
  resultProcess.arguments = [
    "--fail", "--silent", "--show-error", "--max-time", "30",
    "-X", "POST", "-H", "content-type: application/json",
    "-H", "authorization: Bearer \(script.deviceToken)",
    "--data-binary", "@-", endpoint,
  ]

  let input = Pipe()
  let output = Pipe()
  resultProcess.standardInput = input
  resultProcess.standardOutput = output
  resultProcess.standardError = output

  do {
    try resultProcess.run()
    input.fileHandleForWriting.write(data)
    try input.fileHandleForWriting.close()
    let response = output.fileHandleForReading.readDataToEndOfFile()
    resultProcess.waitUntilExit()

    if resultProcess.terminationStatus != 0 {
      log("result post failed (\(resultProcess.terminationStatus)): \(String(decoding: response, as: UTF8.self))")
    }
  } catch {
    log("result post could not start: \(error)")
  }
}

// MARK: - Trigger evaluation

func shouldRun(_ script: InstalledScript, state: inout ScriptState, now: Date,
  startupDue: Bool) -> [String]
{
  var due: [String] = []
  let digest = scriptDigest(script)

  if script.runId != nil, !state.executedRuns.contains(script.runId!) { due.append("manual") }

  switch script.trigger.type {
  case "install":
    if state.digest != digest { due.append("install") }
  case "startup":
    if startupDue { due.append("startup") }
  case "interval":
    let interval = Double(max(60, script.trigger.intervalSeconds ?? 3600))
    let last = state.lastRun["interval"] ?? 0

    if now.timeIntervalSince1970 - last >= interval { due.append("interval") }
  case "cron":
    let minute = Int(now.timeIntervalSince1970 / 60)

    if state.lastMinute["cron"] != minute, cronMatches(script.trigger.cronExpression, now) {
      due.append("cron")
    }
  default:
    break
  }

  return due
}

func tick(scripts: [InstalledScript], state: inout AgentState, now: Date) {
  let boot = bootTime()
  let console = consoleUser()
  let network = networkHash()
  let previousConsole = state.lastConsoleUser

  for script in scripts {
    var scriptState = state.scripts[script.id] ?? ScriptState()
    let digest = scriptDigest(script)
    var triggers = shouldRun(
      script, state: &scriptState, now: now, startupDue: state.lastBoot != boot)

    if !previousConsole.isEmpty || !console.isEmpty {
      if previousConsole != console {
        if !console.isEmpty, script.trigger.type == "login" { triggers.append("login") }
        if !previousConsole.isEmpty, script.trigger.type == "logout" { triggers.append("logout") }
      }
    }

    if script.trigger.type == "network-change", state.lastNetworkHash != network,
      !state.lastNetworkHash.isEmpty
    {
      triggers.append("network-change")
    }

    for trigger in Set(triggers) {
      let result = execute(script, trigger: trigger)
      post(result, script: script)
      scriptState.lastRun[trigger] = now.timeIntervalSince1970

      if trigger == "cron" { scriptState.lastMinute["cron"] = Int(now.timeIntervalSince1970 / 60) }

      if let runId = script.runId {
        scriptState.executedRuns = Array((scriptState.executedRuns + [runId]).suffix(200))
      }

      log("\(script.id) ran (\(trigger)) exit=\(result.exitCode.map(String.init) ?? "none")")
    }

    scriptState.digest = digest
    state.scripts[script.id] = scriptState
  }

  state.lastBoot = boot
  state.lastConsoleUser = console
  state.lastNetworkHash = network
  saveState(state)
}

// MARK: - Entry point

let arguments = Array(CommandLine.arguments.dropFirst())
let command = arguments.first ?? "run"

switch command {
case "version":
  print("mattraxd \(agentVersion)")
case "once":
  var state = loadState()
  tick(scripts: installedScripts(), state: &state, now: Date())
case "run":
  log("mattraxd \(agentVersion) starting")

  while true {
    var state = loadState()
    tick(scripts: installedScripts(), state: &state, now: Date())
    Thread.sleep(forTimeInterval: 30)
  }
default:
  FileHandle.standardError.write(Data("usage: mattraxd [run|once|version]\n".utf8))
  exit(64)
}
