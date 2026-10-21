import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../flow.dart';
import '../pick.dart';
import '../theme.dart';
import '../widgets/bits.dart';
import '../widgets/mentions.dart';
import '../widgets/sidebar.dart';

/// The board: start a task, and see every one at a glance.
class SessionsScreen extends StatelessWidget {
  const SessionsScreen({super.key, required this.flow, required this.onOpen});
  final FlowState flow;
  final void Function(String id) onOpen;

  @override
  Widget build(BuildContext context) {
    final tasks = flow.workspace == null ? flow.tasks : flow.visible;
    return ListView(
      padding: const EdgeInsets.fromLTRB(28, 22, 28, 28),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 880),
            child: NewTask(flow: flow, onStarted: onOpen),
          ),
        ),
        const SizedBox(height: 26),
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 880),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  flow.workspace == null
                      ? 'Sessions'
                      : 'Sessions in ${Sidebar.nameOf(flow.workspace!)}',
                  style: t(12, color: Tern.muted),
                ),
                const SizedBox(height: 10),
                if (tasks == null)
                  Text('Loading…', style: t(12.5, color: Tern.muted))
                else if (tasks.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 26),
                    child: Text(
                      flow.workspace == null
                          ? 'Nothing running. Start something above.'
                          : 'Nothing here yet.',
                      style: t(12.5, color: Tern.muted),
                    ),
                  )
                else
                  for (final task in tasks)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: _TaskRow(task: task, onTap: () => onOpen(task.id)),
                    ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _TaskRow extends StatefulWidget {
  const _TaskRow({required this.task, required this.onTap});
  final Task task;
  final VoidCallback onTap;

  @override
  State<_TaskRow> createState() => _TaskRowState();
}

class _TaskRowState extends State<_TaskRow> {
  bool _over = false;

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final words = statusWords(Task2(task.status, task.phase, task.awaitingPhase));

    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _over = true),
      onExit: (_) => setState(() => _over = false),
      child: GestureDetector(
        onTap: widget.onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
          decoration: BoxDecoration(
            color: _over ? Tern.raised : Tern.panel,
            border: Border.all(color: _over ? Tern.lineStrong : Tern.line),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(children: [
            StatusDot(task.status),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(task.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: t(13, color: Tern.ink, weight: FontWeight.w500)),
                  const SizedBox(height: 3),
                  Text(
                    '${task.repos.join(' + ')}  ·  $words',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: t(11.5, color: Tern.muted),
                  ),
                ],
              ),
            ),
            if (task.cost > 0)
              Text('\$${task.cost.toStringAsFixed(2)}',
                  style: t(11.5, color: Tern.muted, code: true)),
            const SizedBox(width: 10),
            const Icon(Icons.chevron_right, size: 16, color: Tern.faint),
          ]),
        ),
      ),
    );
  }
}

/// The form. Everything the server will accept, and nothing it will not.
class NewTask extends StatefulWidget {
  const NewTask({super.key, required this.flow, required this.onStarted});
  final FlowState flow;
  final void Function(String id) onStarted;

  @override
  State<NewTask> createState() => _NewTaskState();
}

class _NewTaskState extends State<NewTask> {
  final _prompt = TextEditingController();
  final _title = TextEditingController();
  final _picked = <String>{};
  final _attached = <String>[];

  String _run = 'full';
  String? _model;
  String? _effort;
  String? _mode;
  bool _unattended = false;
  bool _more = false;
  bool _busy = false;

  String? _shopConfig;
  String? _shopStore;
  Map<String, dynamic>? _shopify;

  @override
  void initState() {
    super.initState();
    _prompt.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _prompt.dispose();
    _title.dispose();
    super.dispose();
  }

  Map<String, dynamic> get _options => widget.flow.options ?? const {};
  Map<String, dynamic> get _defaults => widget.flow.defaults ?? const {};

  /// What "default" actually resolves to, so the chip is not a mystery.
  String _defaultWord(String key) {
    final value = (_defaults[key] ?? '') as String;
    return value.isEmpty ? "the CLI's own" : value;
  }

  Future<void> _toggleRepo(String name) async {
    setState(() {
      _picked.contains(name) ? _picked.remove(name) : _picked.add(name);
      _shopify = null;
      _shopConfig = null;
      _shopStore = null;
    });
    // Only a repo with a shopify.app.toml has anything to offer.
    for (final repo in _picked) {
      try {
        final found = await widget.flow.api.shopify(repo);
        if (!mounted) return;
        if ((found['configs'] as List?)?.isNotEmpty ?? false) {
          setState(() => _shopify = found);
          return;
        }
      } catch (_) {
        // Not a Shopify app, which is the ordinary case.
      }
    }
  }

  Future<void> _attach() async {
    final path = await Pick.file();
    if (path == null) return;
    try {
      final file = File(path);
      final saved =
          await widget.flow.api.upload(file.uri.pathSegments.last, await file.readAsBytes());
      if (!mounted) return;
      setState(() => _attached.add(saved['path'] as String));
    } catch (err) {
      widget.flow.fail(err);
    }
  }

  Future<void> _start() async {
    if (_prompt.text.trim().isEmpty || _picked.isEmpty || _busy) return;
    setState(() => _busy = true);
    try {
      final task = await widget.flow.api.create({
        'prompt': _prompt.text.trim(),
        if (_title.text.trim().isNotEmpty) 'title': _title.text.trim(),
        'repos': _picked.toList(),
        'run': _run,
        'autoApprove': _unattended,
        if (_model != null) 'model': _model,
        if (_effort != null) 'effort': _effort,
        if (_mode != null) 'permissionMode': _mode,
        if (_attached.isNotEmpty) 'attachments': _attached,
        if (_shopConfig != null)
          'shopify': {'config': _shopConfig, if (_shopStore != null) 'store': _shopStore},
      });
      if (!mounted) return;
      _prompt.clear();
      _title.clear();
      setState(() {
        _attached.clear();
        _busy = false;
      });
      await widget.flow.loadState();
      widget.onStarted(task.id);
    } catch (err) {
      widget.flow.fail(err);
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Only the workspace being shown, so a repo list of 40 is not what you
    // scroll past to start a task in one of them.
    final workspace = widget.flow.workspace;
    final repos = workspace == null
        ? widget.flow.repos
        : widget.flow.repos.where((r) => r['root'] == workspace).toList();
    final runs = (_options['runs'] as List?) ?? const [];
    final ready = _prompt.text.trim().isNotEmpty && _picked.isNotEmpty;

    return Panel(
      colour: Tern.input,
      border: Tern.lineStrong,
      radius: 18,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('New task', style: t(11.5, color: Tern.muted)),
          const SizedBox(height: 8),
          ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 46, maxHeight: 260),
            child: Mentions(
              controller: _prompt,
              // Only the repos ticked: @ should not offer a file from a repo
              // this task will never have a worktree for.
              repos: _picked.toList(),
              api: widget.flow.api,
              child: CallbackShortcuts(
                bindings: {
                  const SingleActivator(LogicalKeyboardKey.enter, meta: true): _start,
                  const SingleActivator(LogicalKeyboardKey.enter, control: true): _start,
                },
                child: TextField(
                  controller: _prompt,
                  maxLines: null,
                  style: t(14.5, color: Tern.ink2),
                  decoration: InputDecoration.collapsed(
                    hintText:
                        'e.g. get-discounts should return targeted product and collection names, capped at 5',
                    hintStyle: t(14.5, color: Tern.faint),
                  ),
                ),
              ),
            ),
          ),
          if (_attached.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              children: [
                for (final path in _attached)
                  Chip2(
                    label: path.split(RegExp(r'[\\/]')).last,
                    icon: Icons.attachment,
                    onTap: () => setState(() => _attached.remove(path)),
                    tooltip: 'Click to remove',
                  ),
              ],
            ),
          ],
          const SizedBox(height: 14),
          Text('Repos', style: t(11.5, color: Tern.muted)),
          const SizedBox(height: 7),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final repo in repos)
                Chip2(
                  label: repo['name'] as String,
                  selected: _picked.contains(repo['name']),
                  onTap: () => _toggleRepo(repo['name'] as String),
                  tooltip: repo['path'] as String?,
                ),
            ],
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final run in runs)
                Chip2(
                  label: (run as Map)['label'] as String,
                  selected: _run == run['value'],
                  tooltip: run['hint'] as String?,
                  onTap: () => setState(() => _run = run['value'] as String),
                ),
              Chip2(
                label: 'Run unattended',
                icon: _unattended ? Icons.check : null,
                selected: _unattended,
                tooltip: 'Skips both gates, and answers its own questions.',
                onTap: () => setState(() => _unattended = !_unattended),
              ),
              Chip2(
                label: _more ? 'Fewer options' : 'More options',
                onTap: () => setState(() => _more = !_more),
              ),
            ],
          ),
          if (_more) ...[
            const SizedBox(height: 14),
            _row('Title', [
              SizedBox(
                width: 320,
                child: _field(_title, 'Optional. The agent names it otherwise.'),
              ),
            ]),
            const SizedBox(height: 10),
            _choices('Model', 'model', (_options['models'] as List?)?.cast<String>() ?? const [],
                _model, (v) => setState(() => _model = v)),
            const SizedBox(height: 10),
            _choices('Effort', 'effort', (_options['efforts'] as List?)?.cast<String>() ?? const [],
                _effort, (v) => setState(() => _effort = v)),
            const SizedBox(height: 10),
            _modes(),
            if (_shopify != null) ...[
              const SizedBox(height: 10),
              _shopifyChips(),
            ],
          ],
          const SizedBox(height: 16),
          Row(children: [
            Chip2(label: 'Attach', icon: Icons.attach_file, onTap: _attach),
            const Spacer(),
            Text(sendHint, style: t(10.5, color: Tern.muted, code: true)),
            const SizedBox(width: 10),
            FlowButton(
              label: 'Start',
              tone: Tone.primary,
              icon: Icons.play_arrow_rounded,
              busy: _busy,
              onPressed: ready ? _start : null,
            ),
          ]),
        ],
      ),
    );
  }

  Widget _field(TextEditingController c, String hint) => Container(
        height: 32,
        padding: const EdgeInsets.symmetric(horizontal: 11),
        alignment: Alignment.centerLeft,
        decoration: BoxDecoration(
          color: Tern.raised,
          border: Border.all(color: Tern.lineStrong),
          borderRadius: BorderRadius.circular(16),
        ),
        child: TextField(
          controller: c,
          style: t(12, color: Tern.ink2),
          decoration: InputDecoration.collapsed(
            hintText: hint,
            hintStyle: t(12, color: Tern.faint),
          ),
        ),
      );

  Widget _row(String label, List<Widget> children) => Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SizedBox(width: 72, child: Text(label, style: t(11.5, color: Tern.muted))),
          ...children,
        ],
      );

  Widget _choices(String label, String key, List<String> values, String? chosen,
          void Function(String?) pick) =>
      _row(label, [
        Expanded(
          child: Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final value in values)
                Chip2(
                  label: value.isEmpty ? 'Default (${_defaultWord(key)})' : value,
                  selected: value.isEmpty ? chosen == null : chosen == value,
                  onTap: () => pick(value.isEmpty ? null : value),
                ),
            ],
          ),
        ),
      ]);

  Widget _modes() {
    final modes = (_options['modes'] as List?) ?? const [];
    return _row('Access', [
      Expanded(
        child: Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final mode in modes)
              Chip2(
                label: (mode as Map)['label'] as String,
                tooltip: mode['hint'] as String?,
                selected: _mode == null
                    ? mode['value'] == _defaults['permissionMode']
                    : _mode == mode['value'],
                onTap: () => setState(() => _mode = mode['value'] as String),
              ),
          ],
        ),
      ),
    ]);
  }

  /// `shopify app dev` rewrites an app's URLs on the Partner dashboard, so
  /// which app it points at is never guessed.
  Widget _shopifyChips() {
    final configs = (_shopify!['configs'] as List?) ?? const [];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _row('App', [
          Expanded(
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final config in configs)
                  Chip2(
                    label: (config as Map)['appName'] as String? ?? config['config'] as String,
                    selected: _shopConfig == config['config'],
                    tooltip: 'shopify app dev will repoint this app',
                    onTap: () => setState(() {
                      _shopConfig = config['config'] as String;
                      _shopStore = config['store'] as String?;
                    }),
                  ),
              ],
            ),
          ),
        ]),
        if (_shopStore != null) ...[
          const SizedBox(height: 8),
          _row('Store', [Text(_shopStore!, style: t(12, color: Tern.ink3, code: true))]),
        ],
      ],
    );
  }
}
