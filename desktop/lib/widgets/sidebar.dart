import 'dart:io';

import 'package:flutter/material.dart';

import '../api.dart';
import '../flow.dart';
import '../prefs.dart';
import '../pick.dart';
import '../theme.dart';
import 'bits.dart';

/// The workspaces, and what has been going on in each of them.
///
/// A workspace is one of the folders the tool was pointed at; the repos inside
/// it are what a task can be started against. The first nine take a shortcut,
/// because switching between two of them is the thing you do all day.
class Sidebar extends StatelessWidget {
  const Sidebar({
    super.key,
    required this.flow,
    required this.onOpen,
    required this.onPick,
    this.prefs,
    this.recent = 5,
  });

  final FlowState flow;

  /// For the continue-on-launch switch; absent means the switch is not shown.
  final Prefs? prefs;
  final void Function(String id) onOpen;

  /// Null for all of them. Not `flow.pickWorkspace` directly: choosing a
  /// workspace also means leaving whatever task is open, or the choice
  /// changes a board you are not looking at.
  final void Function(String? root) onPick;
  final int recent;

  static String nameOf(String root) =>
      root.split(RegExp(r'[\\/]')).where((p) => p.isNotEmpty).lastOrNull ?? root;

  @override
  Widget build(BuildContext context) {
    final roots = flow.roots;

    // With a task open, the workspace you are in is that task's, whatever the
    // board happens to be filtered to. Showing the filter instead left the
    // conversation highlighted under a workspace it does not belong to.
    final open = flow.detail;
    final current = open != null ? flow.rootOf(open) : flow.workspace;

    return Container(
      width: 244,
      decoration: const BoxDecoration(
        color: Tern.panel,
        border: Border(right: BorderSide(color: Tern.line)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(10, 14, 10, 10),
              children: [
                _AllRow(
                  selected: current == null,
                  count: (flow.tasks ?? const []).length,
                  onTap: () => onPick(null),
                ),
                const SizedBox(height: 10),
                for (var i = 0; i < roots.length; i++) ...[
                  _Workspace(
                    name: nameOf(roots[i]),
                    path: roots[i],
                    index: i,
                    selected: current == roots[i],
                    onTap: () => onPick(roots[i]),
                  ),
                  ..._conversations(roots[i]),
                  const SizedBox(height: 12),
                ],
              ],
            ),
          ),
          const Divider(height: 1, color: Tern.line),
          if (prefs != null) _AutoResume(prefs: prefs!),
          _Disk(flow: flow),
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 0, 10, 10),
            child: _AddFolder(flow: flow),
          ),
        ],
      ),
    );
  }

  List<Widget> _conversations(String root) {
    final mine = (flow.tasks ?? const <Task>[])
        .where((t) => flow.rootOf(t) == root)
        .take(recent)
        .toList();

    if (mine.isEmpty) {
      return [
        Padding(
          padding: const EdgeInsets.only(left: 10, top: 3),
          child: Text('nothing yet', style: t(11, color: Tern.faint)),
        ),
      ];
    }
    return [
      for (final task in mine)
        _Conversation(
          task: task,
          selected: flow.selected == task.id,
          onTap: () => onOpen(task.id),
        ),
    ];
  }
}

class _AllRow extends StatelessWidget {
  const _AllRow({required this.selected, required this.count, required this.onTap});
  final bool selected;
  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => _Row(
        selected: selected,
        onTap: onTap,
        child: Row(children: [
          Icon(Icons.inbox_outlined, size: 14, color: selected ? Tern.ink : Tern.muted),
          const SizedBox(width: 8),
          Expanded(
            child: Text('Everything',
                style: t(12.5, color: selected ? Tern.ink : Tern.ink3)),
          ),
          Text('$count', style: t(11, color: Tern.faint, code: true)),
        ]),
      );
}

class _Workspace extends StatelessWidget {
  const _Workspace({
    required this.name,
    required this.path,
    required this.index,
    required this.selected,
    required this.onTap,
  });

  final String name;
  final String path;
  final int index;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    final key = Platform.isMacOS ? 'Cmd' : 'Ctrl';
    return Tooltip(
      message: index < 9 ? '$path\n$key+${index + 1}' : path,
      waitDuration: const Duration(milliseconds: 700),
      child: _Row(
        selected: selected,
        onTap: onTap,
        child: Row(children: [
          Expanded(
            child: Text(
              name,
              overflow: TextOverflow.ellipsis,
              style: t(12.5,
                  color: selected ? accent : Tern.ink2, weight: FontWeight.w600),
            ),
          ),
          if (index < 9)
            Container(
              width: 17,
              height: 17,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: selected ? accent.withValues(alpha: 0.16) : Tern.raised,
                border: Border.all(color: selected ? accent.withValues(alpha: 0.5) : Tern.line),
                borderRadius: BorderRadius.circular(5),
              ),
              child: Text(
                '${index + 1}',
                style: t(10.5, color: selected ? accent : Tern.muted, code: true),
              ),
            ),
        ]),
      ),
    );
  }
}

class _Conversation extends StatelessWidget {
  const _Conversation({required this.task, required this.selected, required this.onTap});
  final Task task;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(left: 8),
        child: _Row(
          selected: selected,
          dense: true,
          onTap: onTap,
          child: Row(children: [
            StatusDot(task.status, size: 6),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                task.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: t(11.5, color: selected ? Tern.ink : Tern.muted),
              ),
            ),
          ]),
        ),
      );
}

/// One hover-and-select row, so every line in here behaves the same.
class _Row extends StatefulWidget {
  const _Row({
    required this.child,
    required this.selected,
    required this.onTap,
    this.dense = false,
  });

  final Widget child;
  final bool selected;
  final VoidCallback onTap;
  final bool dense;

  @override
  State<_Row> createState() => _RowState();
}

class _RowState extends State<_Row> {
  bool _over = false;

  @override
  Widget build(BuildContext context) => MouseRegion(
        cursor: SystemMouseCursors.click,
        onEnter: (_) => setState(() => _over = true),
        onExit: (_) => setState(() => _over = false),
        child: GestureDetector(
          onTap: widget.onTap,
          child: Container(
            padding: EdgeInsets.symmetric(horizontal: 9, vertical: widget.dense ? 5 : 7),
            margin: const EdgeInsets.only(bottom: 2),
            decoration: BoxDecoration(
              color: widget.selected
                  ? Tern.selected
                  : (_over ? Tern.raised : Colors.transparent),
              borderRadius: BorderRadius.circular(8),
            ),
            child: widget.child,
          ),
        ),
      );
}

/// What the checkouts are costing. Without this, dropping one looks like it
/// did nothing: the branches stay, the conversation stays, and the only thing
/// that changed was a number nobody was showing.
/// Interrupted tasks are picked up when the app launches. Off makes it a button.
class _AutoResume extends StatefulWidget {
  const _AutoResume({required this.prefs});
  final Prefs prefs;

  @override
  State<_AutoResume> createState() => _AutoResumeState();
}

class _AutoResumeState extends State<_AutoResume> {
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 10, 0),
        child: Row(children: [
          const Icon(Icons.play_circle_outline, size: 13, color: Tern.faint),
          const SizedBox(width: 7),
          Expanded(
            child: Tooltip(
              message: 'Takes effect the next time the app starts',
              child: Text('Continue on launch', style: t(11, color: Tern.muted)),
            ),
          ),
          SizedBox(
            height: 18,
            child: FittedBox(
              child: Switch(
                value: widget.prefs.autoResume,
                onChanged: (on) => setState(() => widget.prefs.set(autoResume: on)),
              ),
            ),
          ),
        ]),
      );
}

class _Disk extends StatefulWidget {
  const _Disk({required this.flow});
  final FlowState flow;

  @override
  State<_Disk> createState() => _DiskState();
}

class _DiskState extends State<_Disk> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => widget.flow.loadDisk());
  }

  static String _size(num bytes) {
    if (bytes >= 1 << 30) return '${(bytes / (1 << 30)).toStringAsFixed(1)} GB';
    if (bytes >= 1 << 20) return '${(bytes / (1 << 20)).round()} MB';
    return '${(bytes / 1024).round()} KB';
  }

  @override
  Widget build(BuildContext context) {
    final disk = widget.flow.disk;
    final total = (disk?['total'] as num?) ?? 0;
    final free = (disk?['reclaimable'] as num?) ?? 0;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 12, 8),
      child: Row(children: [
        const Icon(Icons.save_outlined, size: 13, color: Tern.faint),
        const SizedBox(width: 7),
        Expanded(
          child: Text(
            disk == null ? 'measuring…' : '${_size(total)} in worktrees',
            style: t(11, color: Tern.muted),
          ),
        ),
        if (free > 0)
          Tooltip(
            message: 'Droppable from finished tasks',
            child: Text(_size(free), style: t(10.5, color: Tern.faint, code: true)),
          ),
      ]),
    );
  }
}

class _AddFolder extends StatefulWidget {
  const _AddFolder({required this.flow});
  final FlowState flow;

  @override
  State<_AddFolder> createState() => _AddFolderState();
}

class _AddFolderState extends State<_AddFolder> {
  bool _busy = false;

  Future<void> _add() async {
    final path = await Pick.folder();
    if (path == null) return;
    setState(() => _busy = true);
    try {
      await widget.flow.api.addRoot(path);
      await widget.flow.loadState();
    } catch (err) {
      widget.flow.fail(err);
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) => FlowButton(
        label: 'Add workspace',
        icon: Icons.create_new_folder_outlined,
        dense: true,
        busy: _busy,
        onPressed: _add,
      );
}
