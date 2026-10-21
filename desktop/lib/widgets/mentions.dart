import 'dart:async';

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

  /// `@` then anything that could still be part of a path, right at the cursor.
  static final _token = RegExp(r'@([\w./-]*)$');

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onType);
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
    _debounce = Timer(const Duration(milliseconds: 140), () => _look(match.group(1) ?? ''));
  }

  Future<void> _look(String query) async {
    try {
      final hits = await widget.api.files(widget.repos, query);
      if (!mounted || _at < 0) return;
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
    return Positioned(
      width: 460,
      child: CompositedTransformFollower(
        link: _link,
        targetAnchor: Alignment.topLeft,
        followerAnchor: Alignment.bottomLeft,
        offset: const Offset(0, -8),
        child: Material(
          color: Colors.transparent,
          child: Container(
            constraints: const BoxConstraints(maxHeight: 232),
            decoration: BoxDecoration(
              color: Tern.raised,
              border: Border.all(color: Tern.lineStrong),
              borderRadius: BorderRadius.circular(10),
              boxShadow: const [BoxShadow(color: Color(0x88000000), blurRadius: 18)],
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
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                      decoration: BoxDecoration(
                        color: i == _chosen ? Tern.selected : Colors.transparent,
                        borderRadius: BorderRadius.circular(7),
                      ),
                      child: Row(children: [
                        Text(path.substring(slash + 1),
                            style: t(12, color: i == _chosen ? Tern.ink : Tern.ink3, code: true)),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            slash < 0 ? '' : path.substring(0, slash),
                            overflow: TextOverflow.ellipsis,
                            style: t(11, color: Tern.faint, code: true),
                          ),
                        ),
                        if (widget.repos.length > 1)
                          Text(hit['repo'] as String,
                              style: t(10.5, color: accent, code: true)),
                      ]),
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
                _Dismiss: CallbackAction<_Dismiss>(onInvoke: (_) => setState(_close)),
                _Move: CallbackAction<_Move>(onInvoke: (intent) => _move(intent.by)),
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
