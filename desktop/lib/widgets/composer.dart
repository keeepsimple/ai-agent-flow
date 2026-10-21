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
  Widget _modelPicker(Task task) {
    final models =
        (widget.flow.options?['models'] as List?)?.cast<String>() ?? const [];
    if (models.isEmpty) return const SizedBox.shrink();
    final cli = (widget.flow.defaults?['cliModel'] as String?) ?? '';
    final now = task.model ?? '';
    String label(String m) =>
        m.isNotEmpty ? m : (cli.isEmpty ? 'default' : 'default ($cli)');

    return PopupMenuButton<String>(
      tooltip: 'The model the next run uses',
      padding: EdgeInsets.zero,
      color: Tern.raised,
      onSelected: (picked) {
        if (picked == now) return;
        widget.flow.run(() => widget.flow.api.setModel(task.id, picked));
      },
      itemBuilder: (_) => [
        for (final m in models)
          PopupMenuItem(
            value: m,
            height: 32,
            child: Text(
              label(m),
              style: t(12, color: m == now ? Tern.ink : Tern.ink3),
            ),
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
      child: Panel(
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
