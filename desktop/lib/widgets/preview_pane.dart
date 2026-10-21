import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../flow.dart';
import '../theme.dart';
import 'bits.dart';
import 'markdown_view.dart' show openExternal;

/// The latest screenshot the agent took, refreshed while it runs, and a way
/// to open the running app in the tool's own browser.
class PreviewPane extends StatefulWidget {
  const PreviewPane({super.key, required this.task, required this.flow, this.initial});
  final Task task;
  final FlowState flow;

  /// For tests: skips the fetch and the polling.
  final List<Map<String, dynamic>>? initial;

  @override
  State<PreviewPane> createState() => _PreviewPaneState();
}

class _PreviewPaneState extends State<PreviewPane> {
  List<Map<String, dynamic>>? _shots;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    if (widget.initial != null) {
      _shots = widget.initial;
    } else {
      _refresh();
      // Only while it runs: a finished task's screenshots do not change.
      _poll = Timer.periodic(const Duration(seconds: 5), (_) { if (widget.task.active) _refresh(); });
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final shots = await widget.flow.api.shots(widget.task.id);
      if (mounted) setState(() => _shots = shots);
    } catch (_) {
      // Nothing taken yet is not worth a banner.
    }
  }

  Future<void> _open() async {
    try {
      final out = await widget.flow.api.preview(widget.task.id, '');
      final url = (out as Map)['url'] as String?;
      if (url != null) await openExternal(url);
    } catch (err) {
      widget.flow.fail(err);
    }
  }

  @override
  Widget build(BuildContext context) {
    final shots = _shots ?? const <Map<String, dynamic>>[];
    final latest = shots.firstOrNull;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 10, 6),
        child: Row(children: [
          Expanded(
            child: Text(
              latest == null ? 'No screenshot yet' : '${latest['name']}  ·  ${shots.length} taken',
              overflow: TextOverflow.ellipsis,
              style: t(11.5, color: Tern.muted, code: true),
            ),
          ),
          FlowButton(dense: true, label: 'Open in browser', icon: Icons.open_in_new, onPressed: _open),
        ]),
      ),
      Expanded(
        child: latest == null
            ? Center(
                child: Text(
                  'The agent takes one with the preview script when it looks at the app.',
                  style: t(12, color: Tern.faint),
                  textAlign: TextAlign.center,
                ),
              )
            : InteractiveViewer(
                child: Image.network(
                  widget.flow.api.shotUrl(widget.task.id, latest['name'] as String),
                  key: ValueKey(latest['name']),
                  fit: BoxFit.contain,
                  alignment: Alignment.topCenter,
                  errorBuilder: (_, __, ___) => Center(child: Text('Could not load ${latest['name']}', style: t(12, color: Tern.muted))),
                ),
              ),
      ),
    ]);
  }
}
