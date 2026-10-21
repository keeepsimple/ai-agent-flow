import 'dart:io';

import 'package:flutter/material.dart';

import '../api.dart';
import '../flow.dart';
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
    this.recent = 5,
  });

  final FlowState flow;
  final void Function(String id) onOpen;
  final int recent;

  static String nameOf(String root) =>
      root.split(RegExp(r'[\\/]')).where((p) => p.isNotEmpty).lastOrNull ?? root;

  @override
  Widget build(BuildContext context) {
    final roots = flow.roots;

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
                  selected: flow.workspace == null,
                  count: (flow.tasks ?? const []).length,
                  onTap: () => flow.pickWorkspace(null),
                ),
                const SizedBox(height: 10),
                for (var i = 0; i < roots.length; i++) ...[
                  _Workspace(
                    name: nameOf(roots[i]),
                    path: roots[i],
                    index: i,
                    selected: flow.workspace == roots[i],
                    onTap: () => flow.pickWorkspace(roots[i]),
                  ),
                  ..._conversations(roots[i]),
                  const SizedBox(height: 12),
                ],
              ],
            ),
          ),
          const Divider(height: 1, color: Tern.line),
          Padding(
            padding: const EdgeInsets.all(10),
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
