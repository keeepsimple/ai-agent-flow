import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../theme.dart';

/// The `@` in a prompt box: name a file without going to look it up.
///
/// Wraps a field rather than replacing it, so the two prompt boxes keep their
/// own shape and only gain this.
class Mentions extends StatefulWidget {
  const Mentions({
    super.key,
    required this.controller,
    required this.repos,
    required this.api,
    required this.child,
  });

  final TextEditingController controller;
  final List<String> repos;
  final Api api;
  final Widget child;

  @override
  State<Mentions> createState() => _MentionsState();
}

class _MentionsState extends State<Mentions> {
  final _link = LayerLink();
  final _scroll = ScrollController();

  Timer? _debounce;
  OverlayEntry? _overlay;
  List<Map<String, dynamic>> _hits = const [];
  int _chosen = 0;
  int _at = -1; // where the @ sits, or -1 when nothing is being typed

  /// Which lookup is the current one. The first `@` of a session pays for a
  /// `git ls-files` per repo — 300ms over a workspace of 28 — and every one
  /// after that is served from the cache in five. So the answer to `@` comes
  /// back after the answer to `@compos`, and the list went back to showing
  /// everything the moment you typed enough to narrow it.
  int _asked = 0;

  /// `@` then anything that could still be part of a path, right at the cursor.
  static final _token = RegExp(r'@([\w./-]*)$');

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onType);
  }

  // Handed a different controller, it would otherwise go on listening to the
  // old one and the @ would quietly do nothing for ever.
  @override
  void didUpdateWidget(Mentions old) {
    super.didUpdateWidget(old);
    if (old.controller == widget.controller) return;
    old.controller.removeListener(_onType);
    widget.controller.addListener(_onType);
    setState(_close);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onType);
    _debounce?.cancel();
    _close();
    _scroll.dispose();
    super.dispose();
  }

  void _onType() {
    final selection = widget.controller.selection;
    if (!selection.isValid || !selection.isCollapsed || widget.repos.isEmpty) {
      if (_overlay != null) setState(_close);
      return;
    }

    final before = widget.controller.text.substring(0, selection.baseOffset);
    final match = _token.firstMatch(before);
    if (match == null) {
      if (_overlay != null) setState(_close);
      return;
    }

    _at = match.start;
    _debounce?.cancel();
    _debounce = Timer(
      const Duration(milliseconds: 140),
      () => _look(match.group(1) ?? ''),
    );
  }

  Future<void> _look(String query) async {
    final mine = ++_asked;
    try {
      final hits = await widget.api.files(widget.repos, query);
      if (!mounted || _at < 0 || mine != _asked) return;
      setState(() {
        _hits = hits;
        _chosen = 0;
      });
      setState(() => hits.isEmpty ? _close() : _show());
    } catch (_) {
      // A file list is a convenience: failing to offer one is not an error
      // worth putting in front of someone mid-sentence.
      _close();
    }
  }

  void _show() {
    _overlay?.markNeedsBuild();
    if (_overlay != null) return;
    _overlay = OverlayEntry(builder: _build);
    Overlay.of(context).insert(_overlay!);
  }

  void _close() {
    _at = -1;
    _overlay?.remove();
    _overlay = null;
  }

  /// With more than one repo in play a bare path says too little, so it is
  /// named the way the prompt names the worktrees.
  void _insert(Map<String, dynamic> hit) {
    final path = widget.repos.length > 1
        ? '${hit['repo']}/${hit['path']}'
        : hit['path'] as String;
    final text = widget.controller.text;
    final cursor = widget.controller.selection.baseOffset;
    final next = '${text.substring(0, _at)}$path ${text.substring(cursor)}';
    _close();
    widget.controller.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: _at + path.length + 1),
    );
  }

  void _move(int by) {
    setState(() => _chosen = (_chosen + by + _hits.length) % _hits.length);
    _overlay?.markNeedsBuild();
  }

  Widget _build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;

    // It used to open upward always, which is right for the composer at the
    // foot of a workspace and wrong for the New task box at the top of the
    // board: there the list ran off the top of the window. Measure instead.
    final box = this.context.findRenderObject() as RenderBox?;
    final screen = MediaQuery.of(context).size.height;
    var above = screen, below = screen;
    if (box != null && box.hasSize) {
      final top = box.localToGlobal(Offset.zero).dy;
      above = top;
      below = screen - (top + box.size.height);
    }
    final down = below >= above;
    // Never taller than the room it has, so it cannot be clipped either way.
    final room = math.max(96.0, (down ? below : above) - 16);

    return Positioned(
      width: 460,
      child: CompositedTransformFollower(
        link: _link,
        targetAnchor: down ? Alignment.bottomLeft : Alignment.topLeft,
        followerAnchor: down ? Alignment.topLeft : Alignment.bottomLeft,
        offset: Offset(0, down ? 8 : -8),
        child: Material(
          color: Colors.transparent,
          child: Container(
            constraints: BoxConstraints(maxHeight: math.min(232, room)),
            decoration: BoxDecoration(
              color: Tern.raised,
              border: Border.all(color: Tern.lineStrong),
              borderRadius: BorderRadius.circular(10),
              boxShadow: const [
                BoxShadow(color: Color(0x88000000), blurRadius: 18),
              ],
            ),
            clipBehavior: Clip.antiAlias,
            child: ListView.builder(
              controller: _scroll,
              shrinkWrap: true,
              padding: const EdgeInsets.all(4),
              itemCount: _hits.length,
              itemBuilder: (context, i) {
                final hit = _hits[i];
                final path = hit['path'] as String;
                final slash = path.lastIndexOf('/');
                return GestureDetector(
                  onTap: () => _insert(hit),
                  child: MouseRegion(
                    cursor: SystemMouseCursors.click,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: i == _chosen
                            ? Tern.selected
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(7),
                      ),
                      child: Row(
                        children: [
                          Text(
                            path.substring(slash + 1),
                            style: t(
                              12,
                              color: i == _chosen ? Tern.ink : Tern.ink3,
                              code: true,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              slash < 0 ? '' : path.substring(0, slash),
                              overflow: TextOverflow.ellipsis,
                              style: t(11, color: Tern.faint, code: true),
                            ),
                          ),
                          if (widget.repos.length > 1)
                            Text(
                              hit['repo'] as String,
                              style: t(10.5, color: accent, code: true),
                            ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // A multiline field consumes Enter before any ancestor sees it, so the
    // keys are bound here instead: the nearest Shortcuts wins over the
    // editing defaults, which live up at the root of the app.
    final field = _overlay == null
        ? widget.child
        : Shortcuts(
            shortcuts: const {
              SingleActivator(LogicalKeyboardKey.enter): _Accept(),
              SingleActivator(LogicalKeyboardKey.tab): _Accept(),
              SingleActivator(LogicalKeyboardKey.escape): _Dismiss(),
              SingleActivator(LogicalKeyboardKey.arrowDown): _Move(1),
              SingleActivator(LogicalKeyboardKey.arrowUp): _Move(-1),
            },
            child: Actions(
              actions: {
                _Accept: CallbackAction<_Accept>(
                  onInvoke: (_) => _insert(_hits[_chosen]),
                ),
                _Dismiss: CallbackAction<_Dismiss>(
                  onInvoke: (_) => setState(_close),
                ),
                _Move: CallbackAction<_Move>(
                  onInvoke: (intent) => _move(intent.by),
                ),
              },
              child: widget.child,
            ),
          );

    return CompositedTransformTarget(link: _link, child: field);
  }
}

class _Accept extends Intent {
  const _Accept();
}

class _Dismiss extends Intent {
  const _Dismiss();
}

class _Move extends Intent {
  const _Move(this.by);
  final int by;
}
