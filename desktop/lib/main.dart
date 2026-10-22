import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import 'api.dart';
import 'flow.dart';
import 'notifier.dart';
import 'screens/prompts.dart';
import 'widgets/settings_dialog.dart';
import 'screens/sessions.dart';
import 'screens/workspace.dart';
import 'server.dart';
import 'shortcuts.dart';
import 'prefs.dart';
import 'theme.dart';
import 'window.dart';
import 'widgets/bits.dart';
import 'widgets/header.dart';
import 'widgets/sidebar.dart';
import 'widgets/tabs.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AgentFlowApp());
}

int get _port => int.tryParse(Platform.environment['FLOW_PORT'] ?? '') ?? 7777;

class AgentFlowApp extends StatefulWidget {
  const AgentFlowApp({super.key});

  @override
  State<AgentFlowApp> createState() => _AgentFlowAppState();
}

class _AgentFlowAppState extends State<AgentFlowApp>
    with WidgetsBindingObserver {
  final _server = FlowServer(_port);
  late final FlowState _flow = FlowState(Api(_port));

  final _prefs = Prefs.load();
  final _window = WindowState();
  late final _notifier = Notifier(onOpened: _open);
  Accent _accent = Accent.sky;
  bool _ready = false;
  String? _trouble;
  bool _prompts = false;

  /// The conversations left open, oldest first. Restored at launch, minus any
  /// task that has been deleted since.
  late List<String> _tabs = _prefs.tabs;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _boot();
  }

  Future<void> _boot() async {
    final up = await _server.start(_prefs);
    if (!mounted) return;
    if (!up) {
      setState(() => _trouble = _server.trouble ?? 'The server did not start.');
      return;
    }
    // Before listening: it decides whether the server keeps raising its own.
    _flow.onNotify = (event) => _notifier.show(
      title: (event['title'] ?? 'Agent Flow') as String,
      body: (event['body'] ?? '') as String,
      taskId: event['taskId'] as String?,
      urgent: event['urgent'] == true,
    );

    await _flow.loadState();
    // Only after the roots are known: a remembered workspace that has since
    // been removed would otherwise filter the board down to nothing.
    final remembered = _prefs.workspace;
    if (remembered != null && _flow.roots.contains(remembered)) {
      _flow.pickWorkspace(remembered);
    }
    _flow.listen();
    // A tab for a task that no longer exists is a dead end, and the store is
    // the only thing that knows which those are.
    final alive = (_flow.tasks ?? const <Task>[]).map((t) => t.id).toSet();
    _tabs = _tabs.where(alive.contains).toList();
    _prefs.set(tabs: _tabs);
    if (mounted) setState(() => _ready = true);
  }

  /// Quitting takes the server with it, and the server takes its agents.
  @override
  Future<ui.AppExitResponse> didRequestAppExit() async {
    await _server.stop();
    return ui.AppExitResponse.exit;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _window.dispose();
    _flow.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Agent Flow',
      debugShowCheckedModeBanner: false,
      theme: ternTheme(_accent),
      home: AnimatedBuilder(
        animation: Listenable.merge([_flow, _window]),
        builder: (context, _) =>
            Scaffold(backgroundColor: Tern.page, body: _body(context)),
      ),
    );
  }

  void _toggleSidebar() {
    setState(() => _prefs.set(sidebarOpen: !_prefs.sidebarOpen));
  }

  Widget _body(BuildContext context) {
    if (_trouble != null) {
      return Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _trouble!,
                textAlign: TextAlign.center,
                style: t(13, color: Tern.ink),
              ),
              const SizedBox(height: 10),
              Text(
                'Run it from a terminal to see why.',
                style: t(12, color: Tern.muted),
              ),
            ],
          ),
        ),
      );
    }
    if (!_ready) {
      return Center(
        child: Text('Starting the server…', style: t(12.5, color: Tern.muted)),
      );
    }

    final task = _flow.detail;
    final showing = _flow.selected != null && task != null;

    // High in the tree on purpose: a key the focused text field does not want
    // travels up to here, so typing is never interrupted and the shortcut
    // still works from anywhere.
    // Shortcuts only see a key on its way up from whatever has focus, so
    // without something focused inside this subtree the event never passes
    // through here at all. Clicking a field moves focus off this again,
    // which is fine: the field is inside it.
    return CallbackShortcuts(
      bindings: _workspaceKeys(),
      child: Focus(
        autofocus: true,
        child: Stack(
          children: [
            Column(
              children: [
                Header(
                  flow: _flow,
                  sidebarOpen: _prefs.sidebarOpen,
                  fullScreen: _window.fullScreen,
                  onToggleSidebar: _toggleSidebar,
                  task: showing ? task : null,
                  onBack: () => _flow.select(null),
                  accent: _accent,
                  onAccent: (a) => setState(() => _accent = a),
                  onDropped: () {},
                  onDeleted: () => _flow.select(null),
                  onPrompts: () => setState(() => _prompts = !_prompts),
                  onSettings: () => showDialog<void>(
                    context: context,
                    builder: (_) => SettingsDialog(flow: _flow),
                  ),
                  promptsOpen: _prompts,
                ),
                Expanded(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Slides rather than pops. The width animates against a
                      // clip while the panel itself stays its full 244, which
                      // is what OverflowBox is holding open: laying a 244-wide
                      // child into a 0-wide box is an overflow, not a slide.
                      ClipRect(
                        child: AnimatedContainer(
                          duration: smooth,
                          curve: ease,
                          width: _prefs.sidebarOpen ? 244 : 0,
                          child: OverflowBox(
                            alignment: Alignment.centerLeft,
                            minWidth: 244,
                            maxWidth: 244,
                            child: Sidebar(
                              flow: _flow,
                              onOpen: _open,
                              onPick: _pickWorkspace,
                              prefs: _prefs,
                            ),
                          ),
                        ),
                      ),
                      Expanded(
                        child: Column(
                          children: [
                            TabStrip(
                              tabs: _tabs,
                              tasks: _flow.tasks ?? const [],
                              selected: _flow.selected,
                              onPick: _flow.select,
                              onClose: _close,
                              onBoard: () => _flow.select(null),
                            ),
                            Expanded(
                              child: AnimatedSwitcher(
                                duration: smooth,
                                switchInCurve: ease,
                                switchOutCurve: ease,
                                // Keyed on which screen and which task, not on
                                // the data in them: without that the switcher
                                // would cross-fade the whole screen every time
                                // a log line arrived. The task id has to be in
                                // it, or switching tabs keeps the screen that
                                // was there — with the previous task's open
                                // tool blocks, chosen file and scroll.
                                child: KeyedSubtree(
                                  key: ValueKey(
                                    showing
                                        ? 'task/${task.id}'
                                        : (_prompts ? 'prompts' : 'sessions'),
                                  ),
                                  child: showing
                                      ? WorkspaceScreen(
                                          flow: _flow,
                                          task: task,
                                          prefs: _prefs,
                                        )
                                      : (_prompts
                                            ? PromptsScreen(flow: _flow)
                                            : SessionsScreen(
                                                flow: _flow,
                                                onOpen: _open,
                                              )),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (_flow.error != null)
              Positioned(
                left: 0,
                right: 0,
                bottom: 22,
                child: Center(
                  child: Panel(
                    colour: Tern.input,
                    border: const Color(0x80FF8080),
                    radius: 10,
                    padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Flexible(
                          child: Text(
                            _flow.error!,
                            style: t(12.5, color: Tern.bad),
                          ),
                        ),
                        const SizedBox(width: 10),
                        MouseRegion(
                          cursor: SystemMouseCursors.click,
                          child: GestureDetector(
                            onTap: _flow.clearError,
                            child: const Icon(
                              Icons.close,
                              size: 14,
                              color: Tern.muted,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  void _open(String id) {
    setState(() {
      _prompts = false;
      if (!_tabs.contains(id)) {
        _tabs = [..._tabs, id];
        _prefs.set(tabs: _tabs);
      }
    });
    _flow.select(id);
  }

  /// Closing a tab leaves the task alone: it keeps running, and the board
  /// still has it. What goes is the shortcut.
  void _close(String id) {
    final next = afterClosing(_tabs, id);
    final left = [..._tabs]..remove(id);
    setState(() {
      _tabs = left;
      _prefs.set(tabs: left);
    });
    if (_flow.selected != id) return;
    _flow.select(next);
  }

  /// Switching shows the board, because that is what the choice changes.
  /// Choosing a workspace shows the board: that is what the choice changes.
  /// The sidebar and the shortcuts both come through here, so clicking a name
  /// and pressing its key cannot drift apart.
  void _pickWorkspace(String? root) {
    _prompts = false;
    _flow.pickWorkspace(root);
    _flow.select(null);
    _prefs.set(workspace: root, clearWorkspace: root == null);
  }

  Map<ShortcutActivator, VoidCallback> _workspaceKeys() {
    return workspaceShortcuts(
      workspaces: _flow.roots.length,
      onWorkspace: (i) => _pickWorkspace(_flow.roots[i]),
      onEverything: () => _pickWorkspace(null),
      onToggleSidebar: _toggleSidebar,
    );
  }
}
