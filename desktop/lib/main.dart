import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import 'api.dart';
import 'flow.dart';
import 'screens/review.dart';
import 'screens/sessions.dart';
import 'screens/workspace.dart';
import 'server.dart';
import 'theme.dart';
import 'widgets/bits.dart';
import 'widgets/header.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AgentFlowApp());
}

int get _port =>
    int.tryParse(Platform.environment['FLOW_PORT'] ?? '') ?? 7777;

class AgentFlowApp extends StatefulWidget {
  const AgentFlowApp({super.key});

  @override
  State<AgentFlowApp> createState() => _AgentFlowAppState();
}

class _AgentFlowAppState extends State<AgentFlowApp> with WidgetsBindingObserver {
  final _server = FlowServer(_port);
  late final FlowState _flow = FlowState(Api(_port));

  Accent _accent = Accent.sky;
  bool _ready = false;
  String? _trouble;
  String _tab = 'workspace';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _boot();
  }

  Future<void> _boot() async {
    final up = await _server.start();
    if (!mounted) return;
    if (!up) {
      setState(() => _trouble = _server.trouble ?? 'The server did not start.');
      return;
    }
    await _flow.loadState();
    _flow.listen();
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
    _flow.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Agent FlowState',
      debugShowCheckedModeBanner: false,
      theme: ternTheme(_accent),
      home: AnimatedBuilder(
        animation: _flow,
        builder: (context, _) => Scaffold(
          backgroundColor: Tern.page,
          body: _body(context),
        ),
      ),
    );
  }

  Widget _body(BuildContext context) {
    if (_trouble != null) {
      return Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(_trouble!, textAlign: TextAlign.center, style: t(13, color: Tern.ink)),
            const SizedBox(height: 10),
            Text('Run it from a terminal to see why.',
                style: t(12, color: Tern.muted)),
          ]),
        ),
      );
    }
    if (!_ready) {
      return Center(child: Text('Starting the server…', style: t(12.5, color: Tern.muted)));
    }

    final task = _flow.detail;
    final showing = _flow.selected != null && task != null;

    return Stack(children: [
      Column(children: [
        Header(
          flow: _flow,
          task: showing ? task : null,
          tab: _tab,
          onTab: (name) => setState(() => _tab = name),
          onBack: () => _flow.select(null),
          accent: _accent,
          onAccent: (a) => setState(() => _accent = a),
          onDropped: () {},
          onDeleted: () => _flow.select(null),
        ),
        Expanded(
          child: showing
              ? (_tab == 'review'
                  ? ReviewScreen(flow: _flow, task: task)
                  : WorkspaceScreen(flow: _flow, task: task))
              : SessionsScreen(
                  flow: _flow,
                  onOpen: (id) {
                    setState(() => _tab = 'workspace');
                    _flow.select(id);
                  },
                ),
        ),
      ]),
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
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Flexible(
                  child: Text(_flow.error!, style: t(12.5, color: Tern.bad)),
                ),
                const SizedBox(width: 10),
                MouseRegion(
                  cursor: SystemMouseCursors.click,
                  child: GestureDetector(
                    onTap: _flow.clearError,
                    child: const Icon(Icons.close, size: 14, color: Tern.muted),
                  ),
                ),
              ]),
            ),
          ),
        ),
    ]);
  }
}
