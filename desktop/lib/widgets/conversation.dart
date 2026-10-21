import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';
import 'bits.dart';
import 'markdown_view.dart';

/// The transcript. Tool calls arrive in runs of dozens, so they are collapsed
/// to a line saying how many; the rest reads as what it is.
class Conversation extends StatefulWidget {
  const Conversation({
    super.key,
    required this.task,
    this.footer,
    this.jumpToEnd,
    this.onFile,
  });
  final Task task;
  final Widget? footer;

  /// A file name in a message was tapped.
  final void Function(String name)? onFile;

  /// Bump it to scroll to the end: the status line is a shortcut to the last message.
  final ValueNotifier<int>? jumpToEnd;

  @override
  State<Conversation> createState() => _ConversationState();
}

class _ConversationState extends State<Conversation> {
  final _scroll = ScrollController();
  final _open = <int>{};
  bool _pinned = true;
  int _seen = 0;

  @override
  void initState() {
    super.initState();
    widget.jumpToEnd?.addListener(_jump);
    _scroll.addListener(() {
      if (!_scroll.hasClients) return;
      final pinned =
          _scroll.position.pixels >= _scroll.position.maxScrollExtent - 60;
      if (pinned == _pinned) return;
      setState(() => _pinned = pinned);
    });
  }

  void _jump() {
    // Through setState: the listener below would otherwise see the value it
    // already holds, take its early return, and leave the button on screen.
    setState(() => _pinned = true);
    if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
  }

  /// The button's own scroll. Animated, unlike the stick-to-bottom that runs
  /// while the agent is talking: that one has to land before the next frame of
  /// log arrives, this one is a person asking to be taken somewhere.
  void _toBottom() {
    if (!_scroll.hasClients) return;
    _scroll.animateTo(
      _scroll.position.maxScrollExtent,
      duration: const Duration(milliseconds: 260),
      curve: ease,
    );
  }

  @override
  void dispose() {
    widget.jumpToEnd?.removeListener(_jump);
    _scroll.dispose();
    super.dispose();
  }

  void _stickToBottom() {
    if (!_pinned) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  List<_Block>? _cached;
  int _cachedFor = -1;

  /// Grouping walks the whole log, so it is done when the log changes rather
  /// than on every frame. A running task emits log lines several times a
  /// second, and every one of them was regrouping four hundred entries.
  List<_Block> _blocks() {
    if (_cached != null && _cachedFor == widget.task.log.length) {
      return _cached!;
    }
    _cachedFor = widget.task.log.length;
    return _cached = _group();
  }

  /// Consecutive tool calls are one block; everything else stands alone.
  List<_Block> _group() {
    final out = <_Block>[];
    for (final entry in widget.task.log) {
      final kind = entry['kind'] as String?;
      if (kind == 'tool' && out.isNotEmpty && out.last.kind == 'tools') {
        out.last.items.add(entry);
      } else if (kind == 'tool') {
        out.add(_Block('tools', [entry]));
      } else {
        out.add(_Block(kind ?? 'text', [entry]));
      }
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final blocks = _blocks();
    if (task.log.length != _seen) {
      _seen = task.log.length;
      _stickToBottom();
    }

    // Lazy on purpose: with `children:` every block was built on every frame,
    // which meant re-parsing the markdown of the whole conversation each time
    // a log line arrived. Only what is on screen is built now.
    return Stack(
      children: [
        Scrollbar(
          controller: _scroll,
          child: ListView.builder(
            controller: _scroll,
            padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
            itemCount: blocks.length + 2,
            itemBuilder: (context, i) {
              if (i == 0) return _opening(task);
              if (i <= blocks.length) {
                return Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: _render(
                    context,
                    blocks[i - 1],
                    i - 1,
                    i == blocks.length,
                  ),
                );
              }
              return _closing(task, blocks);
            },
          ),
        ),
        // Only while there is something below to go back to. It slides out of
        // the way rather than vanishing, so the eye can follow where it went.
        Positioned(
          right: 20,
          bottom: 14,
          child: IgnorePointer(
            ignoring: _pinned,
            child: AnimatedSlide(
              duration: smooth,
              curve: ease,
              offset: _pinned ? const Offset(0, 0.6) : Offset.zero,
              child: AnimatedOpacity(
                duration: smooth,
                curve: ease,
                opacity: _pinned ? 0 : 1,
                child: FlowButton(
                  dense: true,
                  label: 'Latest',
                  icon: Icons.arrow_downward,
                  tooltip: 'Jump to the newest message',
                  onPressed: _toBottom,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// What the human asked, and who answered.
  Widget _opening(Task task) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Panel(
              colour: Tern.selected,
              border: Tern.lineStrong,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              child: SelectableText(
                task.prompt,
                style: t(13, color: Tern.ink2),
              ),
            ),
          ),
        ),
        if (task.attachments.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Align(
              alignment: Alignment.centerRight,
              child: Wrap(
                spacing: 6,
                children: [
                  for (final path in task.attachments)
                    _Attachment(path.split(RegExp(r'[\\/]')).last),
                ],
              ),
            ),
          ),
        const SizedBox(height: 16),
        Row(
          children: [
            Container(
              width: 20,
              height: 20,
              decoration: BoxDecoration(
                color: Tern.avatar,
                borderRadius: BorderRadius.circular(6),
              ),
              alignment: Alignment.center,
              child: Text(
                'T',
                style: t(11, color: Tern.ink3, weight: FontWeight.w600),
              ),
            ),
            const SizedBox(width: 9),
            Text(
              'Tern · ${task.model ?? 'default'}',
              style: t(11.5, color: Tern.muted),
            ),
          ],
        ),
        const SizedBox(height: 14),
      ],
    );
  }

  /// Whatever is still to come, and anything the screen wants under it.
  Widget _closing(Task task, List<_Block> blocks) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (task.running && (blocks.isEmpty || blocks.last.kind != 'tools'))
          Row(
            children: [
              StatusDot(task.status, size: 7),
              const SizedBox(width: 9),
              Text('working', style: t(12, color: Tern.muted)),
            ],
          ),
        if (widget.footer != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: widget.footer!,
          ),
      ],
    );
  }

  Widget _render(BuildContext context, _Block block, int index, bool last) {
    switch (block.kind) {
      case 'tools':
        return _tools(block, index, last);
      case 'result':
        final entry = block.items.first;
        final cost = (entry['cost'] as num?)?.toStringAsFixed(3) ?? '0';
        return Row(
          children: [
            const Expanded(child: Divider(color: Tern.line, height: 1)),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text(
                '\$$cost · ${entry['turns'] ?? 0} turns',
                style: t(11, color: Tern.muted, code: true),
              ),
            ),
            const Expanded(child: Divider(color: Tern.line, height: 1)),
          ],
        );
      case 'error':
      case 'stderr':
        return Panel(
          colour: const Color(0xFF17100F),
          border: const Color(0xFF5C2A2A),
          child: SelectableText(
            (block.items.first['text'] ?? '') as String,
            style: t(11.5, color: Tern.bad, code: true),
          ),
        );
      case 'question':
      case 'answer':
      case 'decision':
        final mine = block.kind != 'question';
        final entry = block.items.first;
        return Align(
          alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: mine ? 560 : double.infinity),
            child: Panel(
              colour: mine ? Tern.selected : Tern.warnBg,
              border: mine ? Tern.lineStrong : Tern.warnLine,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    block.kind == 'question' ? 'Tern asked you' : 'You',
                    style: t(11, color: mine ? Tern.muted : Tern.warn),
                  ),
                  const SizedBox(height: 4),
                  SelectableText(
                    (entry['text'] ?? '') as String,
                    style: t(13, color: Tern.ink2, height: 1.5),
                  ),
                ],
              ),
            ),
          ),
        );
      default:
        return MarkdownView(
          (block.items.first['text'] ?? '') as String,
          onFile: widget.onFile,
        );
    }
  }

  Widget _tools(_Block block, int index, bool last) {
    final live = widget.task.running && last;
    final open = _open.contains(index);
    final items = block.items;
    final latest = items.last;

    return Panel(
      colour: Tern.raised,
      border: Tern.line,
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () =>
                setState(() => open ? _open.remove(index) : _open.add(index)),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              child: Row(
                children: [
                  Icon(
                    open
                        ? Icons.keyboard_arrow_down
                        : Icons.keyboard_arrow_right,
                    size: 16,
                    color: Tern.muted,
                  ),
                  const SizedBox(width: 6),
                  if (live) ...[
                    StatusDot('running', size: 7),
                    const SizedBox(width: 8),
                  ],
                  Text(
                    items.length == 1 ? '1 step' : '${items.length} steps',
                    style: t(12.5, color: Tern.ink2),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      open ? '' : _line(latest),
                      overflow: TextOverflow.ellipsis,
                      style: t(11.5, color: Tern.muted, code: true),
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (open)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 12, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final item in items)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(
                            width: 74,
                            child: Text(
                              (item['tool'] ?? '') as String,
                              style: t(11.5, color: Tern.ink3),
                            ),
                          ),
                          Expanded(
                            child: SelectableText(
                              (item['text'] ?? '') as String,
                              style: t(11.5, color: Tern.muted, code: true),
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
    );
  }

  String _line(Map<String, dynamic> entry) {
    final tool = (entry['tool'] ?? '') as String;
    final text = (entry['text'] ?? '') as String;
    return text.isEmpty ? tool : '$tool  $text';
  }
}

class _Block {
  _Block(this.kind, this.items);
  final String kind;
  final List<Map<String, dynamic>> items;
}

class _Attachment extends StatelessWidget {
  const _Attachment(this.name);
  final String name;

  @override
  Widget build(BuildContext context) {
    final image = RegExp(
      r'\.(png|jpe?g|gif|webp)$',
      caseSensitive: false,
    ).hasMatch(name);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: Tern.raised,
        border: raised(Tern.line),
        borderRadius: BorderRadius.circular(8),
        boxShadow: e1,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            image ? Icons.image_outlined : Icons.description_outlined,
            size: 13,
            color: Tern.muted,
          ),
          const SizedBox(width: 6),
          Text(
            name.replaceFirst(RegExp(r'^[0-9a-f]{8}-'), ''),
            style: t(11, color: Tern.ink3),
          ),
        ],
      ),
    );
  }
}
