import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../flow.dart';
import '../paste.dart';
import '../theme.dart';
import 'bits.dart';
import 'secrets.dart';
import 'mentions.dart';

/// The box at the foot of a task: ask for one more thing on the same branches.
class Composer extends StatefulWidget {
  const Composer({super.key, required this.task, required this.flow});
  final Task task;
  final FlowState flow;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  final _text = TextEditingController();
  final _focus = FocusNode();
  final _attached = <String>[];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _text.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }

  /// The model the next run uses.
  ///
  /// The CLI args are rebuilt on every spawn, so this cannot reach a run that
  /// is already talking, and the tooltip does not pretend it can.
  /// Model and effort are both read fresh at each spawn, so a pick here lands
  /// on the next run and never on the one already talking.
  Widget _picker({
    required String kind,
    required List<String> options,
    required String now,
    required String Function(String) label,
    required void Function(String) onPick,
  }) {
    if (options.isEmpty) return const SizedBox.shrink();
    return PopupMenuButton<String>(
      tooltip: 'The $kind the next run uses',
      padding: EdgeInsets.zero,
      color: Tern.raised,
      onSelected: (picked) {
        if (picked != now) onPick(picked);
      },
      itemBuilder: (_) => [
        for (final (i, option) in options.indexed)
          PopupMenuItem(
            value: option,
            height: 34,
            child: Row(children: [
              SizedBox(
                width: 18,
                child: Text('${i + 1}', style: t(11, color: Tern.faint, code: true)),
              ),
              Expanded(
                child: Text(
                  label(option),
                  style: t(12.5, color: option == now ? Tern.ink : Tern.ink3,
                      weight: option == now ? FontWeight.w600 : FontWeight.w400),
                ),
              ),
              if (option == now)
                Icon(Icons.check, size: 14,
                    color: Theme.of(context).colorScheme.primary),
            ]),
          ),
      ],
      child: Container(
        height: 30,
        padding: const EdgeInsets.only(left: 11, right: 6),
        decoration: BoxDecoration(
          color: Tern.raised,
          border: raised(Tern.lineStrong),
          borderRadius: BorderRadius.circular(15),
          boxShadow: e1,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(label(now), style: t(12, color: Tern.ink3)),
            const Icon(Icons.expand_more, size: 15, color: Tern.muted),
          ],
        ),
      ),
    );
  }

  Widget _modelPicker(Task task) {
    final cli = (widget.flow.defaults?['cliModel'] as String?) ?? '';
    return _picker(
      kind: 'model',
      options:
          (widget.flow.options?['models'] as List?)?.cast<String>() ?? const [],
      now: task.model ?? '',
      label: (m) => m.isNotEmpty
          ? m
          : (cli.isEmpty ? 'CLI default' : 'CLI default ($cli)'),
      onPick: (m) =>
          widget.flow.run(() => widget.flow.api.setModel(task.id, m)),
    );
  }

  Widget _effortPicker(Task task) => _picker(
    kind: 'effort',
    options:
        (widget.flow.options?['efforts'] as List?)?.cast<String>() ?? const [],
    now: task.effort ?? '',
    label: (e) => e.isEmpty ? 'default' : e,
    onPick: (e) => widget.flow.run(() => widget.flow.api.setEffort(task.id, e)),
  );

  Future<void> _send() async {
    final body = _text.text.trim();
    // Running is not a reason to refuse it. The server holds it until the
    // run in front of it is done, which is what you wanted when you typed it.
    if (body.isEmpty || _busy) return;
    setState(() => _busy = true);
    final request = [body, ..._attached.map((p) => 'Attached: $p')].join('\n');
    final hide = await askToHideSecrets(
      context,
      widget.flow,
      text: request,
      attachments: _attached,
      editsOnly: widget.task.raw['permissionMode'] == 'acceptEdits',
    );
    if (hide == null) {
      if (mounted) setState(() => _busy = false);
      return;
    }
    final ok = await widget.flow.run(
      () =>
          widget.flow.api.followUp(widget.task.id, request, hideSecrets: hide),
    );
    if (!mounted) return;
    if (ok) {
      _text.clear();
      _attached.clear();
    }
    setState(() => _busy = false);
  }

  Future<void> _attachFile() => attachInto(
    api: widget.flow.api,
    onAttached: (path) => setState(() => _attached.add(path)),
    onError: widget.flow.fail,
  );

  Future<void> _paste() => pasteInto(
    controller: _text,
    api: widget.flow.api,
    onAttached: (path) => setState(() => _attached.add(path)),
    onError: widget.flow.fail,
  );

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final dropped = task.root == null;
    final running = task.running;

    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 10, 24, 18),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
      _Queued(flow: widget.flow, task: task),
      Panel(
        colour: Tern.input,
        border: Tern.lineStrong,
        radius: 16,
        elevation: 2,
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 40, maxHeight: 220),
              child: Mentions(
                controller: _text,
                repos: task.repos,
                api: widget.flow.api,
                child: CallbackShortcuts(
                  bindings: {
                    const SingleActivator(LogicalKeyboardKey.enter, meta: true):
                        _send,
                    const SingleActivator(
                      LogicalKeyboardKey.enter,
                      control: true,
                    ): _send,
                    const SingleActivator(LogicalKeyboardKey.keyV, meta: true):
                        _paste,
                  },
                  child: TextField(
                    controller: _text,
                    focusNode: _focus,
                    maxLines: null,
                    style: t(13, color: Tern.ink2),
                    decoration: InputDecoration.collapsed(
                      hintText: running
                          ? 'Tern is working. Anything you send waits its turn.'
                          : dropped
                          ? 'The worktree was dropped. Asking for something checks it back out.'
                          : 'Ask for a change.',
                      hintStyle: t(13, color: Tern.faint),
                    ),
                  ),
                ),
              ),
            ),
            if (_attached.isNotEmpty) ...[
              const SizedBox(height: 8),
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
            const SizedBox(height: 10),
            Row(
              children: [
                // A task on a whole workspace carries a dozen of these. Laid
                // out plainly they ran off the end and took the send button
                // with them, so they get the leftover room and no more.
                Expanded(child: _Repos(task.trees)),
                const SizedBox(width: 8),
                _modelPicker(task),
                const SizedBox(width: 6),
                _effortPicker(task),
                const SizedBox(width: 10),
                Text(sendHint, style: t(10.5, color: Tern.muted, code: true)),
                const SizedBox(width: 8),
                _Round(
                  icon: Icons.attach_file,
                  tooltip: 'Attach a file',
                  onTap: _attachFile,
                ),
                const SizedBox(width: 4),
                _Round(
                  icon: running ? Icons.schedule_send : Icons.arrow_upward,
                  tooltip: running ? 'Send when the run finishes' : 'Send',
                  filled: true,
                  onTap: _text.text.trim().isEmpty || _busy ? null : _send,
                ),
              ],
            ),
          ],
        ),
      ),
        ],
      ),
    );
  }
}

/// The repos this task works in, as many as fit and a count for the rest.
class _Repos extends StatelessWidget {
  const _Repos(this.trees);
  final List<Map<String, dynamic>> trees;

  static const _chip = 26.0;

  @override
  Widget build(BuildContext context) {
    final names = trees.map((t) => '${t['repo']}').toList();

    return LayoutBuilder(
      builder: (context, box) {
        final shown = <String>[];
        var used = 0.0;

        for (final name in names) {
          final width = _width(context, '@$name') + 22;
          // Leave room for the "+n more" chip whenever one is still needed.
          final rest = names.length - shown.length - 1;
          final reserve = rest > 0 ? _width(context, '+$rest more') + 28 : 0;
          if (used + width + reserve > box.maxWidth) break;
          shown.add(name);
          used += width + 6;
        }

        return Row(
          children: [
            for (final name in shown) _pill('@$name', null),
            if (shown.length < names.length)
              _pill(
                '+${names.length - shown.length} more',
                names.skip(shown.length).join('\n'),
              ),
          ],
        );
      },
    );
  }

  static double _width(BuildContext context, String text) {
    final painter = TextPainter(
      text: TextSpan(text: text, style: t(11, code: true)),
      textDirection: TextDirection.ltr,
    )..layout();
    return painter.width;
  }

  Widget _pill(String label, String? tooltip) {
    final pill = Container(
      height: _chip,
      margin: const EdgeInsets.only(right: 6),
      padding: const EdgeInsets.symmetric(horizontal: 10),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: Tern.selected,
        border: raised(Tern.line),
        borderRadius: BorderRadius.circular(13),
        boxShadow: e1,
      ),
      child: Text(label, style: t(11, color: Tern.ink3, code: true)),
    );
    return tooltip == null ? pill : Tooltip(message: tooltip, child: pill);
  }
}

class _Round extends StatelessWidget {
  const _Round({
    required this.icon,
    this.onTap,
    this.tooltip,
    this.filled = false,
  });
  final IconData icon;
  final VoidCallback? onTap;
  final String? tooltip;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    return Tooltip(
      message: tooltip ?? '',
      child: MouseRegion(
        cursor: onTap == null
            ? SystemMouseCursors.basic
            : SystemMouseCursors.click,
        child: GestureDetector(
          onTap: onTap,
          child: Opacity(
            opacity: onTap == null ? 0.3 : 1,
            child: Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: filled ? accent : Colors.transparent,
                shape: BoxShape.circle,
                boxShadow: filled && onTap != null ? accentGlow(accent) : null,
              ),
              child: Icon(
                icon,
                size: 16,
                color: filled ? Tern.onAccent : Tern.muted,
              ),
            ),
          ),
        ),
      ),
    );
  }
}


/// What is still waiting in line, with a way to change your mind about it.
class _Queued extends StatefulWidget {
  const _Queued({required this.flow, required this.task});
  final FlowState flow;
  final Task task;

  @override
  State<_Queued> createState() => _QueuedState();
}

class _QueuedState extends State<_Queued> {
  int? _at;
  final _draft = TextEditingController();

  @override
  void dispose() {
    _draft.dispose();
    super.dispose();
  }

  void _save(int i) {
    final text = _draft.text.trim();
    setState(() => _at = null);
    if (text.isEmpty) return;
    widget.flow.run(() => widget.flow.api.editQueued(widget.task.id, i, text));
  }

  @override
  Widget build(BuildContext context) {
    final queue = widget.task.queued;
    if (queue.isEmpty) return const SizedBox.shrink();

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final (i, text) in queue.indexed)
          Container(
            margin: const EdgeInsets.only(bottom: 6),
            padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
            decoration: BoxDecoration(
              color: Tern.raised,
              border: raised(Tern.line),
              borderRadius: BorderRadius.circular(12),
              boxShadow: e1,
            ),
            child: Row(children: [
              const Icon(Icons.schedule, size: 14, color: Tern.muted),
              const SizedBox(width: 9),
              Expanded(
                child: _at == i
                    ? TextField(
                        controller: _draft,
                        autofocus: true,
                        style: t(12.5, color: Tern.ink),
                        decoration: const InputDecoration(
                          isDense: true,
                          border: InputBorder.none,
                          contentPadding: EdgeInsets.zero,
                        ),
                        onSubmitted: (_) => _save(i),
                        onTapOutside: (_) => _save(i),
                      )
                    : Text(text, style: t(12.5, color: Tern.ink3)),
              ),
              const SizedBox(width: 8),
              Text('${i + 1}/${queue.length}',
                  style: t(11, color: Tern.faint, code: true)),
              _Round(
                icon: Icons.edit_outlined,
                tooltip: 'Reword it',
                onTap: () => setState(() {
                  _draft.text = text;
                  _at = i;
                }),
              ),
              _Round(
                icon: Icons.close,
                tooltip: 'Take it out of the queue',
                onTap: () => widget.flow
                    .run(() => widget.flow.api.dropQueued(widget.task.id, i)),
              ),
            ]),
          ),
      ],
    );
  }
}
