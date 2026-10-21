import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../flow.dart';
import '../paste.dart';
import '../theme.dart';
import '../widgets/bits.dart';
import '../widgets/mentions.dart';
import '../widgets/secrets.dart';
import '../status.dart';
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
                  style: t(
                    26,
                    color: Tern.ink,
                    weight: FontWeight.w600,
                    height: 1.1,
                  ).copyWith(letterSpacing: -0.6),
                ),
                const SizedBox(height: 14),
                if (tasks != null && tasks.any((t) => t.interrupted))
                  _Interrupted(
                    flow: flow,
                    tasks: tasks.where((t) => t.interrupted).toList(),
                  ),
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
                  // Keyed by id: this list reorders by recency, and without a
                  // key Flutter reuses row state by position, so a hover or an
                  // in-flight fade lands on whichever task slid into that slot.
                  for (final task in tasks)
                    Padding(
                      key: ValueKey(task.id),
                      padding: const EdgeInsets.only(bottom: 8),
                      child: _TaskRow(
                        task: task,
                        flow: flow,
                        onTap: () => onOpen(task.id),
                      ),
                    ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Runs cut off by a restart or a sleep. One line each, one Continue for the lot.
class _Interrupted extends StatelessWidget {
  const _Interrupted({required this.flow, required this.tasks});
  final FlowState flow;
  final List<Task> tasks;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 12),
    padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
    decoration: BoxDecoration(
      color: Tern.warnBg,
      border: Border.all(color: Tern.warnLine),
      borderRadius: BorderRadius.circular(8),
    ),
    child: Row(
      children: [
        const Icon(Icons.pause_circle_outline, size: 15, color: Tern.warn),
        const SizedBox(width: 9),
        Expanded(
          child: Text(
            '${tasks.length} interrupted',
            style: t(12.5, color: Tern.ink, weight: FontWeight.w600),
          ),
        ),
        FlowButton(
          dense: true,
          label: 'Continue all',
          tone: Tone.primary,
          icon: Icons.play_arrow,
          onPressed: () => flow.run(() async {
            for (final task in tasks) {
              await flow.api.resume(task.id);
            }
          }),
        ),
      ],
    ),
  );
}

class _TaskRow extends StatefulWidget {
  const _TaskRow({required this.task, required this.flow, required this.onTap});
  final Task task;
  final FlowState flow;
  final VoidCallback onTap;

  @override
  State<_TaskRow> createState() => _TaskRowState();
}

class _TaskRowState extends State<_TaskRow>
    with SingleTickerProviderStateMixin {
  bool _over = false;
  bool _dropping = false;

  // One-shot, and only for a row that was not on screen a moment ago: the list
  // is keyed by task id, so an existing row keeps its state across the poll and
  // does not re-animate every few seconds.
  late final AnimationController _in = AnimationController(
    vsync: this,
    duration: smooth,
  )..forward();

  @override
  void dispose() {
    _in.dispose();
    super.dispose();
  }

  /// How far through its phases a running task is. Null when there is nothing
  /// to show: a finished task's bar is noise, not information.
  double? get _progress {
    if (!widget.task.running) return null;
    final phases = widget.task.phases;
    if (phases.isEmpty) return null;
    final done = phases.values
        .where((p) => (p as Map)['status'] == 'done')
        .length;
    return (done / phases.length).clamp(0.04, 1.0);
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final accent = Theme.of(context).colorScheme.primary;
    final words = statusWords(
      Task2(task.status, task.phase, task.awaitingPhase),
    );
    final needs = needsOf(task);
    final progress = _progress;

    return FadeTransition(
      opacity: CurvedAnimation(parent: _in, curve: ease),
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        onEnter: (_) => setState(() => _over = true),
        onExit: (_) => setState(() => _over = false),
        child: GestureDetector(
          onTap: widget.onTap,
          child: AnimatedContainer(
            duration: smooth,
            curve: ease,
            padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
            transform: Matrix4.translationValues(0, _over ? -1 : 0, 0),
            decoration: BoxDecoration(
              gradient: litFill(_over ? Tern.raised : Tern.panel),
              border: raised(_over ? Tern.lineStrong : Tern.line),
              borderRadius: BorderRadius.circular(12),
              boxShadow: _over ? e2 : e1,
            ),
            child: Row(
              children: [
                StatusDot(task.status),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        task.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: t(13, color: Tern.ink, weight: FontWeight.w500),
                      ),
                      const SizedBox(height: 3),
                      Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(
                              text: '${task.repos.join(' + ')}  ·  $words',
                            ),
                            if (needs != null && needs != words)
                              TextSpan(
                                text: '  ·  $needs',
                                style: t(11.5, color: Tern.warn),
                              ),
                          ],
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: t(11.5, color: Tern.muted),
                      ),
                      if (progress != null) ...[
                        const SizedBox(height: 8),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(2),
                          child: Stack(
                            children: [
                              Container(height: 3, color: Tern.lineDim),
                              AnimatedFractionallySizedBox(
                                duration: const Duration(milliseconds: 700),
                                curve: ease,
                                widthFactor: progress,
                                child: Container(
                                  height: 3,
                                  decoration: BoxDecoration(
                                    color: accent,
                                    boxShadow: [
                                      BoxShadow(
                                        color: accent.withValues(alpha: 0.9),
                                        blurRadius: 8,
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                if (task.cost > 0)
                  Text(
                    '\$${task.cost.toStringAsFixed(2)}',
                    style: t(11.5, color: Tern.muted, code: true),
                  ),
                // Free the checkout from here, without opening the conversation.
                // The branches stay, so there is nothing to confirm.
                if (task.root != null && !task.active) ...[
                  const SizedBox(width: 10),
                  Tooltip(
                    message: 'Drop the worktree. The conversation and the branches stay.',
                    child: InkWell(
                      borderRadius: BorderRadius.circular(6),
                      // Null while it runs, so a second press cannot start a
                      // second remove on a checkout already going away.
                      onTap: _dropping
                          ? null
                          : () async {
                              setState(() => _dropping = true);
                              try {
                                if (await widget.flow.run(
                                  () => widget.flow.api.dropWorktree(task.id),
                                  refresh: false,
                                )) {
                                  await widget.flow.loadState();
                                  widget.flow.loadDisk();
                                }
                              } finally {
                                if (mounted) setState(() => _dropping = false);
                              }
                            },
                      child: Padding(
                        padding: const EdgeInsets.all(4),
                        child: _dropping
                            // git worktree remove is seconds on a big
                            // checkout. Without this the row sat still and
                            // then jumped, which reads as a freeze.
                            ? const SizedBox(
                                width: 15,
                                height: 15,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.6,
                                  color: Tern.muted,
                                ),
                              )
                            : const Icon(
                                Icons.folder_off_outlined,
                                size: 15,
                                color: Tern.faint,
                              ),
                      ),
                    ),
                  ),
                ],
                const SizedBox(width: 10),
                const Icon(Icons.chevron_right, size: 16, color: Tern.faint),
              ],
            ),
          ),
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

  /// Null is the plain route: one run, no documents, no review. It is what
  /// most of what gets typed in here actually wants.
  String? _run;
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

  Future<void> _attach() => attachInto(
    api: widget.flow.api,
    onAttached: (path) => setState(() => _attached.add(path)),
    onError: widget.flow.fail,
  );

  /// The same Cmd-V as the follow-up box: a screenshot becomes an attachment,
  /// anything else is pasted as text. This box had neither.
  Future<void> _paste() => pasteInto(
    controller: _prompt,
    api: widget.flow.api,
    onAttached: (path) => setState(() => _attached.add(path)),
    onError: widget.flow.fail,
  );

  /// Which repos a task would run against. Ticking none means the whole
  /// workspace: every repo in the folder being shown, one worktree each.
  List<String> _target() {
    if (_picked.isNotEmpty) return _picked.toList();
    final workspace = widget.flow.workspace;
    return widget.flow.repos
        .where((r) => workspace == null || r['root'] == workspace)
        .map((r) => r['name'] as String)
        .toList();
  }

  Future<void> _start() async {
    if (_prompt.text.trim().isEmpty || _target().isEmpty || _busy) return;
    setState(() => _busy = true);
    try {
      final hide = await askToHideSecrets(
        context,
        widget.flow,
        text: _prompt.text.trim(),
        attachments: _attached,
        editsOnly: (_mode ?? _defaults['permissionMode']) == 'acceptEdits',
      );
      if (hide == null) {
        if (mounted) setState(() => _busy = false);
        return;
      }
      final task = await widget.flow.api.create({
        'prompt': _prompt.text.trim(),
        'hideSecrets': hide,
        if (_title.text.trim().isNotEmpty) 'title': _title.text.trim(),
        'repos': _target(),
        'autoApprove': _unattended,
        'run': _run ?? 'ask',
        if (_model != null) 'model': _model,
        if (_effort != null) 'effort': _effort,
        if (_mode != null) 'permissionMode': _mode,
        if (_attached.isNotEmpty) 'attachments': _attached,
        if (_shopConfig != null)
          'shopify': {
            'config': _shopConfig,
            if (_shopStore != null) 'store': _shopStore,
          },
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
    final plain = runs
        .cast<Map>()
        .where((r) => r['value'] == 'ask')
        .firstOrNull;
    final target = _target();
    final ready = _prompt.text.trim().isNotEmpty && target.isNotEmpty;

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
              // The repos this task will actually run against, which is not
              // the same as the ones ticked: ticking none means the whole
              // workspace, and @ was offering nothing at all in that case.
              repos: _target(),
              api: widget.flow.api,
              child: CallbackShortcuts(
                bindings: {
                  const SingleActivator(LogicalKeyboardKey.enter, meta: true):
                      _start,
                  const SingleActivator(
                    LogicalKeyboardKey.enter,
                    control: true,
                  ): _start,
                  const SingleActivator(LogicalKeyboardKey.keyV, meta: true):
                      _paste,
                },
                child: TextField(
                  controller: _prompt,
                  maxLines: null,
                  style: t(14.5, color: Tern.ink2),
                  decoration: InputDecoration.collapsed(
                    hintText: 'e.g. get-discounts should return targeted product and collection names, capped at 5',
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
          Row(
            children: [
              Text('Repos', style: t(11.5, color: Tern.muted)),
              const SizedBox(width: 8),
              // Ticking none is a choice, not an omission, and it is the
              // expensive one: a worktree per repo.
              Text(
                _picked.isEmpty
                    ? (target.isEmpty
                          ? 'no repos in this workspace'
                          : 'none ticked — the whole workspace, ${target.length} repos')
                    : '${_picked.length} of ${repos.length}',
                style: t(11, color: _picked.isEmpty ? Tern.warn : Tern.faint),
              ),
            ],
          ),
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
          Row(
            children: [
              Text('Route', style: t(11.5, color: Tern.muted)),
              const SizedBox(width: 8),
              Tooltip(
                message: (plain?['hint'] as String?) ?? '',
                child: Text(
                  _run == null ? 'normal — no documents, no self review' : '',
                  style: t(11, color: Tern.faint),
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              // The plain route has no chip: it is what not choosing means.
              for (final run in runs.where((r) => (r as Map)['value'] != 'ask'))
                Chip2(
                  label: (run as Map)['label'] as String,
                  selected: _run == run['value'],
                  tooltip: run['hint'] as String?,
                  onTap: () => setState(
                    () => _run = _run == run['value']
                        ? null
                        : run['value'] as String,
                  ),
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
                child: _field(
                  _title,
                  'Optional. The agent names it otherwise.',
                ),
              ),
            ]),
            const SizedBox(height: 10),
            _choices(
              'Model',
              'model',
              (_options['models'] as List?)?.cast<String>() ?? const [],
              _model,
              (v) => setState(() => _model = v),
            ),
            const SizedBox(height: 10),
            _choices(
              'Effort',
              'effort',
              (_options['efforts'] as List?)?.cast<String>() ?? const [],
              _effort,
              (v) => setState(() => _effort = v),
            ),
            const SizedBox(height: 10),
            _modes(),
            if (_shopify != null) ...[
              const SizedBox(height: 10),
              _shopifyChips(),
            ],
          ],
          const SizedBox(height: 16),
          Row(
            children: [
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
            ],
          ),
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
      SizedBox(
        width: 72,
        child: Text(label, style: t(11.5, color: Tern.muted)),
      ),
      ...children,
    ],
  );

  Widget _choices(
    String label,
    String key,
    List<String> values,
    String? chosen,
    void Function(String?) pick,
  ) => _row(label, [
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
                    label:
                        (config as Map)['appName'] as String? ??
                        config['config'] as String,
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
          _row('Store', [
            Text(_shopStore!, style: t(12, color: Tern.ink3, code: true)),
          ]),
        ],
      ],
    );
  }
}
