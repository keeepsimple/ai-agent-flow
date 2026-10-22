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
  // Opens at the newest, the way every other transcript does. It used to open
  // at the top, on the grounds that a finished run reads from the beginning —
  // which was fair when getting to a task meant a trip through the board, and
  // wrong now that tabs make switching cheap: every switch landed four hundred
  // lines above the thing you came back for, and wanted a click on Latest.
  bool _pinned = true;
  bool _jumping = false;
  int _seen = 0;

  @override
  void initState() {
    super.initState();
    widget.jumpToEnd?.addListener(_jump);
    _scroll.addListener(() {
      if (!_scroll.hasClients) return;
      // A jump of our own is not the reader going somewhere. Without this the
      // first hop of a long transcript lands short of an end that has grown
      // since, which reads as "scrolled away" and flashes the Latest button
      // on screen for a moment every time a tab is opened.
      if (_jumping) return;
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
    _toEnd();
  }

  /// All the way down, however far down turns out to be.
  ///
  /// The list builds lazily, so what it calls the end is an estimate from the
  /// children laid out so far. Jumping there lays out more and moves the end
  /// further off — only by a few pixels on an even transcript, but enough to
  /// leave the newest message clipped. So: jump, look again next frame, and
  /// stop when it stops moving. The test measures to the pixel.
  void _toEnd([int tries = 6]) {
    if (!_scroll.hasClients) return;
    final end = _scroll.position.maxScrollExtent;
    _jumping = true;
    _scroll.jumpTo(end);
    if (tries <= 0) return _landed();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return _landed();
      if (_scroll.position.maxScrollExtent > end) {
        _toEnd(tries - 1);
      } else {
        _landed();
      }
    });
  }

  /// At the end, so pinned — said here rather than left to the scroll
  /// listener, which is deaf while a jump of ours is in flight and would
  /// otherwise leave the Latest button up after it had taken you there.
  void _landed() {
    _jumping = false;
    if (_pinned || !mounted) return;
    setState(() => _pinned = true);
  }

  /// The button's own scroll. Animated, unlike the stick-to-bottom that runs
  /// while the agent is talking: that one has to land before the next frame of
  /// log arrives, this one is a person asking to be taken somewhere.
  void _toBottom() {
    if (!_scroll.hasClients) return;
    _scroll
        .animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 260),
          curve: ease,
        )
        // The end it was aiming at moves as the list lays out what the
        // animation uncovered, so it lands short of the real one — and the
        // button it was pressed to retire stays on screen. Close the gap.
        .then((_) {
          if (mounted) _toEnd();
        });
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
      if (mounted) _toEnd();
    });
  }

  List<_Block>? _cached;
  String? _cachedFor;

  /// Grouping walks the whole log, so it is done when the log changes rather
  /// than on every frame. A running task emits log lines several times a
  /// second, and every one of them was regrouping four hundred entries.
  ///
  /// Which task, as well as how long its log is: this widget is reused when
  /// one conversation replaces another, and two tasks the same number of
  /// lines in meant the second one read as the first.
  List<_Block> _blocks() {
    final key = '${widget.task.id}:${widget.task.log.length}';
    if (_cached != null && _cachedFor == key) return _cached!;
    _cachedFor = key;
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
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
            itemCount: blocks.length + 2,
            itemBuilder: (context, i) {
              if (i == 0) return _opening(task);
              if (i <= blocks.length) {
                return Padding(
                  padding: const EdgeInsets.only(bottom: 11),
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
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
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
        const SizedBox(height: 14),
        Row(
          children: [
            const Icon(Icons.auto_awesome, size: 11, color: Tern.faint),
            const SizedBox(width: 6),
            Text(
              'Tern · ${task.model ?? 'default'}'
              '${task.effort != null ? ' · ${task.effort}' : ''}',
              style: t(11, color: Tern.faint),
            ),
          ],
        ),
        const SizedBox(height: 10),
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

  /// What this turn added to the window, and what it produced.
  Widget? _spend(Map<String, dynamic> entry) {
    final added = (entry['added'] ?? 0) as num;
    final out = (entry['out'] ?? 0) as num;
    if (added == 0 && out == 0) return null;
    final parts = [
      if (added > 0) '+${tokens(added)}',
      if (out > 0) '${tokens(out)} out',
    ];
    return Text(parts.join('  '), style: t(10.5, color: Tern.faint, code: true));
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
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
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
        final entry = block.items.first;
        final spend = _spend(entry);
        if (spend == null) {
          return MarkdownView(
            (entry['text'] ?? '') as String,
            onFile: widget.onFile,
          );
        }
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          MarkdownView((entry['text'] ?? '') as String, onFile: widget.onFile),
          const SizedBox(height: 3),
          Align(alignment: Alignment.centerRight, child: spend),
        ]);
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
