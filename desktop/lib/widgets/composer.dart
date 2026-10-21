import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../flow.dart';
import '../pick.dart';
import '../theme.dart';
import 'bits.dart';
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

  Future<void> _send() async {
    final body = _text.text.trim();
    if (body.isEmpty || _busy || widget.task.running) return;
    setState(() => _busy = true);
    final request = [body, ..._attached.map((p) => 'Attached: $p')].join('\n');
    final ok = await widget.flow.run(
      () => widget.flow.api.followUp(widget.task.id, request),
    );
    if (!mounted) return;
    if (ok) {
      _text.clear();
      _attached.clear();
    }
    setState(() => _busy = false);
  }

  Future<void> _attachFile() async {
    final path = await Pick.file();
    if (path == null) return;
    await _upload(File(path));
  }

  /// Flutter's clipboard is text only, so an image is fetched the way the OS
  /// will give it: written out by the shell and read back.
  Future<void> _pasteImage() async {
    final file = await Pick.clipboardImage();
    if (file == null) return;
    await _upload(file);
  }

  Future<void> _upload(File file) async {
    try {
      final saved = await widget.flow.api.upload(
        file.uri.pathSegments.last,
        await file.readAsBytes(),
      );
      if (!mounted) return;
      setState(() => _attached.add(saved['path'] as String));
    } catch (err) {
      widget.flow.fail(err);
    }
  }

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
                        _pasteImage,
                  },
                  child: TextField(
                    controller: _text,
                    focusNode: _focus,
                    maxLines: null,
                    style: t(13, color: Tern.ink2),
                    decoration: InputDecoration.collapsed(
                      hintText: running
                          ? 'Tern is working. This box opens when it stops.'
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
                for (final tree in task.trees)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: Container(
                      height: 26,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: Tern.selected,
                        borderRadius: BorderRadius.circular(13),
                      ),
                      child: Text(
                        '@${tree['repo']}',
                        style: t(11, color: Tern.ink3, code: true),
                      ),
                    ),
                  ),
                const Spacer(),
                Text(sendHint, style: t(10.5, color: Tern.muted, code: true)),
                const SizedBox(width: 8),
                _Round(
                  icon: Icons.attach_file,
                  tooltip: 'Attach a file',
                  onTap: _attachFile,
                ),
                const SizedBox(width: 4),
                _Round(
                  icon: Icons.arrow_upward,
                  tooltip: 'Send',
                  filled: true,
                  onTap: _text.text.trim().isEmpty || _busy || running
                      ? null
                      : _send,
                ),
              ],
            ),
          ],
        ),
      ),
    );
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
