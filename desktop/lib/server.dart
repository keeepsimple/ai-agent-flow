import 'dart:async';
import 'dart:io';

/// Starts and owns the Node server the UI talks to.
///
/// The app is a client. The server is the same one `npm start` runs, carried
/// inside the bundle with its own Node so the machine needs none.
class FlowServer {
  FlowServer(this.port);
  final int port;

  Process? _child;
  String? trouble;

  /// Where the bundle keeps the server and the runtime. Falls back to the
  /// repo when running from source, so `flutter run` works without packaging.
  static ({String node, String entry})? _bundled() {
    final exe = File(Platform.resolvedExecutable).parent;
    final candidates = Platform.isMacOS
        // Contents/MacOS/<exe> -> Contents/Resources/flow
        ? [Directory('${exe.parent.path}/Resources/flow')]
        : [Directory('${exe.path}/flow')];

    for (final dir in candidates) {
      final node = File('${dir.path}/${Platform.isWindows ? 'node.exe' : 'node'}');
      final entry = File('${dir.path}/server/index.js');
      if (node.existsSync() && entry.existsSync()) {
        return (node: node.path, entry: entry.path);
      }
    }
    return null;
  }

  /// Running from source rather than from a packaged bundle: walk up for the
  /// repo, and find a Node the hard way.
  static ({String node, String entry})? _fromSource() {
    var dir = Directory(Platform.resolvedExecutable).parent;
    for (var i = 0; i < 12; i++) {
      final entry = File('${dir.path}/server/index.js');
      if (entry.existsSync()) {
        final node = _findNode();
        return node == null ? null : (node: node, entry: entry.path);
      }
      if (dir.parent.path == dir.path) break;
      dir = dir.parent;
    }
    return null;
  }

  /// A GUI app inherits almost no PATH, so `node` on its own resolves to
  /// nothing: the name has to become a path before it is run. The packaged
  /// app never comes through here, because it carries its own.
  static String? _findNode() {
    final named = Platform.environment['FLOW_NODE_BIN'];
    if (named != null && File(named).existsSync()) return named;

    for (final guess in [
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
      '${Platform.environment['HOME']}/.local/bin/node',
    ]) {
      if (File(guess).existsSync()) return guess;
    }

    // A login shell knows about nvm and the rest, which no fixed list does.
    try {
      final out = Process.runSync('/bin/sh', ['-lc', 'command -v node']);
      final found = (out.stdout as String).trim();
      if (found.isNotEmpty && File(found).existsSync()) return found;
    } catch (_) {
      // Nothing to add: the caller reports that the server did not start.
    }
    return null;
  }

  Future<bool> reachable() async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 1);
    try {
      final request =
          await client.getUrl(Uri.parse('http://127.0.0.1:$port/api/state'));
      final response = await request.close();
      await response.drain<void>();
      return response.statusCode == 200;
    } catch (_) {
      return false;
    } finally {
      client.close(force: true);
    }
  }

  /// Already up means a web-mode server is running; use it rather than
  /// fighting it for the port.
  Future<bool> start() async {
    if (await reachable()) return true;

    final where = _bundled() ?? _fromSource();
    if (where == null) {
      trouble = 'Could not find the server, or a Node to run it with.';
      return false;
    }

    final env = Map<String, String>.from(Platform.environment);
    // A GUI app inherits almost no PATH, and the agent needs git and claude.
    if (!Platform.isWindows) {
      final home = env['HOME'] ?? '';
      env['PATH'] =
          '$home/.local/bin:/opt/homebrew/bin:/usr/local/bin:${env['PATH'] ?? '/usr/bin:/bin'}';
    }
    env['FLOW_PORT'] = '$port';
    // So a desktop notification raised by the server brings this window
    // forward rather than opening a browser at the same page.
    env['FLOW_ACTIVATE'] = 'dev.agentflow.agentFlow';
    env.putIfAbsent('FLOW_DATA', () => dataDir());
    env.putIfAbsent('FLOW_REPO_ROOT', () => _home());
    Directory(env['FLOW_DATA']!).createSync(recursive: true);

    stderr.writeln('flow: starting ${where.node} ${where.entry}');
    try {
      _child = await Process.start(where.node, [where.entry], environment: env);
    } catch (err) {
      trouble = 'Could not start the server: $err';
      return false;
    }
    // Forwarded, not discarded: when the server dies on boot this is the only
    // account of why, and a window cannot show what was thrown away.
    _child!.stdout.listen(stderr.add);
    _child!.stderr.listen(stderr.add);

    // Started is not serving: it still has to bind.
    for (var i = 0; i < 80; i++) {
      if (await reachable()) return true;
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }
    trouble = 'The server started but never answered on port $port.';
    return false;
  }

  /// The server kills its own agents on the way out, which is why this has to
  /// happen rather than being left to the OS reaping a parent.
  Future<void> stop() async {
    final child = _child;
    if (child == null) return;
    child.kill(ProcessSignal.sigterm);
    await child.exitCode.timeout(const Duration(seconds: 8), onTimeout: () {
      child.kill(ProcessSignal.sigkill);
      return -1;
    });
    _child = null;
  }

  static String _home() =>
      Platform.environment['HOME'] ?? Platform.environment['USERPROFILE'] ?? '.';

  static String dataDir() => Platform.isWindows
      ? '${Platform.environment['APPDATA'] ?? _home()}\\Agent Flow'
      : '${_home()}/Library/Application Support/Agent Flow';
}
