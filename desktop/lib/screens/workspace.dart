import 'package:flutter/material.dart';

import '../api.dart';
import '../flow.dart';
import '../prefs.dart';
import '../theme.dart';
import '../widgets/bits.dart';
import '../widgets/composer.dart';
import '../widgets/conversation.dart';
import '../widgets/decision.dart';
import '../widgets/diff_view.dart';
import '../widgets/splitter.dart';
import '../widgets/status_line.dart';

/// Explorer, conversation, and the diff as it is written.
class WorkspaceScreen extends StatefulWidget {
  const WorkspaceScreen({
    super.key,
    required this.flow,
    required this.task,
    required this.prefs,
  });

  final FlowState flow;
  final Task task;
  final Prefs prefs;

  @override
  State<WorkspaceScreen> createState() => _WorkspaceScreenState();
}

class _WorkspaceScreenState extends State<WorkspaceScreen> {
  List<Map<String, dynamic>>? _diff;
  String? _file;
  String? _loadedFor;
  final _jump = ValueNotifier<int>(0);

  @override
  void dispose() {
    _jump.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(WorkspaceScreen old) {
    super.didUpdateWidget(old);
    _refreshDiff();
  }

  @override
  void initState() {
    super.initState();
    _refreshDiff();
  }

  /// The diff is read on arrival and whenever a phase ends: it is a git call
  /// per repo, not something to run on every log line.
  Future<void> _refreshDiff() async {
    final stamp =
        '${widget.task.id}:${widget.task.status}:${widget.task.phase}';
    if (_loadedFor == stamp) return;
    _loadedFor = stamp;
    try {
      final found = await widget.flow.api.diff(widget.task.id);
      if (!mounted) return;
      setState(() {
        _diff = found;
        final files = _files();
        if (_file == null || !files.any((f) => f['path'] == _file)) {
          _file = files.isEmpty ? null : files.first['path'] as String;
        }
      });
    } catch (_) {
      // A task with no worktree has no diff, which is not worth a banner.
    }
  }

  List<Map<String, dynamic>> _files() {
    final out = <Map<String, dynamic>>[];
    for (final repo in _diff ?? const <Map<String, dynamic>>[]) {
      for (final file in (repo['files'] as List?) ?? const []) {
        out.add({
          ...(file as Map).cast<String, dynamic>(),
          'repo': repo['repo'],
        });
      }
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final files = _files();
    final chosen = files.where((f) => f['path'] == _file).firstOrNull;

    return Column(
      children: [
        StatusLine(task: task, onJump: () => _jump.value++),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(width: 232, child: _explorer(task, files)),
              const VerticalDivider(width: 1, color: Tern.line),
              Expanded(
                child: Column(
                  children: [
                    Expanded(
                      child: Conversation(
                        task: task,
                        jumpToEnd: _jump,
                        footer: task.waiting
                            ? Decision(task: task, flow: widget.flow)
                            : null,
                      ),
                    ),
                    Composer(task: task, flow: widget.flow),
                  ],
                ),
              ),
              if (widget.prefs.changesOpen)
                Splitter(
                  onDrag: (delta) => _resize(-delta),
                  onReset: () =>
                      setState(() => widget.prefs.set(changesWidth: 520)),
                )
              else
                const VerticalDivider(width: 1, color: Tern.line),
              _changes(chosen),
            ],
          ),
        ),
      ],
    );
  }

  /// The pane is sized from the right edge, so dragging the handle left makes
  /// it wider. Bounded on both sides: the conversation needs room too, and a
  /// pane too narrow to read a diff in is not worth having open.
  void _resize(double by) {
    final width = MediaQuery.of(context).size.width;
    setState(() {
      widget.prefs.set(
        changesWidth: (widget.prefs.changesWidth + by).clamp(
          280.0,
          width - 520,
        ),
      );
    });
  }

  Widget _changes(Map<String, dynamic>? chosen) {
    final open = widget.prefs.changesOpen;
    final header = Container(
      height: 38,
      // Shut, the strip is only as wide as the button, with no room left for
      // padding around it.
      padding: open
          ? const EdgeInsets.only(left: 14, right: 6)
          : EdgeInsets.zero,
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Tern.line)),
      ),
      child: Row(
        mainAxisAlignment: open
            ? MainAxisAlignment.start
            : MainAxisAlignment.center,
        children: [
          if (open)
            Expanded(
              child: Text(
                chosen == null ? 'Changes' : chosen['path'] as String,
                overflow: TextOverflow.ellipsis,
                style: t(11.5, color: Tern.ink3, code: true),
              ),
            ),
          Tooltip(
            message: open ? 'Hide the diff' : 'Show the diff',
            child: MouseRegion(
              cursor: SystemMouseCursors.click,
              child: GestureDetector(
                onTap: () =>
                    setState(() => widget.prefs.set(changesOpen: !open)),
                child: SizedBox(
                  width: 30,
                  height: 30,
                  child: Icon(
                    open ? Icons.last_page : Icons.first_page,
                    size: 16,
                    color: Tern.muted,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );

    return SizedBox(
      key: const ValueKey('changes-pane'),
      width: open ? widget.prefs.changesWidth : 38,
      child: Container(
        color: Tern.panel,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            header,
            if (open)
              Expanded(
                child: chosen == null
                    ? Center(
                        child: Text(
                          'Nothing changed yet.',
                          style: t(12, color: Tern.muted),
                        ),
                      )
                    : DiffView(chosen['patch'] as String?),
              ),
          ],
        ),
      ),
    );
  }

  Widget _explorer(Task task, List<Map<String, dynamic>> files) => Container(
    color: Tern.panel,
    child: ListView(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      children: [
        Text('Phases', style: t(11, color: Tern.muted)),
        const SizedBox(height: 6),
        for (final entry in task.phases.entries)
          Padding(
            padding: const EdgeInsets.only(bottom: 3),
            child: Row(
              children: [
                Icon(
                  (entry.value as Map)['status'] == 'done'
                      ? Icons.check_circle_outline
                      : Icons.circle_outlined,
                  size: 13,
                  color: (entry.value as Map)['status'] == 'done'
                      ? Tern.ok
                      : Tern.faint,
                ),
                const SizedBox(width: 7),
                Text(
                  phaseLabels[entry.key] ?? entry.key,
                  style: t(12, color: Tern.ink3),
                ),
              ],
            ),
          ),
        if (task.docs.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('Documents', style: t(11, color: Tern.muted)),
          const SizedBox(height: 6),
          for (final name in task.docs.keys)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Row(
                children: [
                  const Icon(
                    Icons.description_outlined,
                    size: 13,
                    color: Tern.faint,
                  ),
                  const SizedBox(width: 7),
                  Text(name, style: t(12, color: Tern.ink3, code: true)),
                ],
              ),
            ),
        ],
        const SizedBox(height: 16),
        Text('Changed files', style: t(11, color: Tern.muted)),
        const SizedBox(height: 6),
        if (files.isEmpty)
          Text('none yet', style: t(11.5, color: Tern.faint))
        else
          for (final file in files)
            _FileRow(
              file: file,
              selected: file['path'] == _file,
              onTap: () => setState(() => _file = file['path'] as String),
            ),
      ],
    ),
  );
}

class _FileRow extends StatelessWidget {
  const _FileRow({
    required this.file,
    required this.selected,
    required this.onTap,
  });
  final Map<String, dynamic> file;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final path = file['path'] as String;
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
          margin: const EdgeInsets.only(bottom: 2),
          decoration: BoxDecoration(
            color: selected ? Tern.selected : Colors.transparent,
            borderRadius: BorderRadius.circular(7),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  path.split('/').last,
                  overflow: TextOverflow.ellipsis,
                  style: t(
                    11.5,
                    color: selected ? Tern.ink : Tern.ink3,
                    code: true,
                  ),
                ),
              ),
              if (file['added'] != null)
                Text(
                  '+${file['added']}',
                  style: t(10.5, color: Tern.ok, code: true),
                ),
              const SizedBox(width: 4),
              if (file['removed'] != null)
                Text(
                  '-${file['removed']}',
                  style: t(10.5, color: Tern.bad, code: true),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
