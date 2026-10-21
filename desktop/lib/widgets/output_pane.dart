import 'package:flutter/material.dart';

import '../api.dart';
import '../flow.dart';
import '../theme.dart';
import 'bits.dart';
import 'markdown_view.dart';

/// What a document task produced: the files in its work folder, newest
/// first. Text renders here; anything else opens with the system.
class OutputPane extends StatefulWidget {
  const OutputPane({
    super.key,
    required this.task,
    required this.flow,
    required this.open,
    required this.width,
    required this.onToggle,
    this.initial,
    this.textInitial,
  });

  final Task task;
  final FlowState flow;
  final bool open;
  final double width;
  final VoidCallback onToggle;

  /// For tests: skips the fetches.
  final List<Map<String, dynamic>>? initial;
  final String? textInitial;

  @override
  State<OutputPane> createState() => _OutputPaneState();
}

class _OutputPaneState extends State<OutputPane> {
  List<Map<String, dynamic>>? _files;
  bool _truncated = false;
  String? _chosen;
  String? _text;
  String? _loadedFor;

  static const _readable = {'md', 'txt', 'csv', 'json', 'log', 'diff', 'patch', 'yml', 'yaml'};

  @override
  void initState() {
    super.initState();
    if (widget.initial != null) {
      _files = widget.initial;
      _chosen = _files!.firstOrNull?['name'] as String?;
      _text = widget.textInitial;
    } else {
      _refresh();
    }
  }

  @override
  void didUpdateWidget(OutputPane old) {
    super.didUpdateWidget(old);
    if (widget.initial == null) _refresh();
  }

  /// Re-read when a run ends, not on every log line.
  Future<void> _refresh() async {
    final stamp = '${widget.task.id}:${widget.task.status}:${widget.task.phase}';
    if (_loadedFor == stamp) return;
    _loadedFor = stamp;
    try {
      final out = await widget.flow.api.output(widget.task.id);
      if (!mounted) return;
      final files = ((out['files'] as List?) ?? const []).cast<Map<String, dynamic>>();
      setState(() {
        _files = files;
        _truncated = out['truncated'] == true;
        if (_chosen == null || !files.any((f) => f['name'] == _chosen)) {
          _chosen = files.firstOrNull?['name'] as String?;
          _text = null;
        }
      });
      await _read();
    } catch (_) {
      // Nothing produced yet is not worth a banner.
    }
  }

  String _ext(String name) => name.contains('.') ? name.split('.').last.toLowerCase() : '';

  Future<void> _read() async {
    final name = _chosen;
    if (name == null || !_readable.contains(_ext(name))) return;
    try {
      final text = await widget.flow.api.outputText(widget.task.id, name);
      if (mounted && _chosen == name) setState(() => _text = text);
    } catch (err) {
      widget.flow.fail(err);
    }
  }

  String _filePath(String name) => '${widget.task.raw['artifactDir']}/work/$name';

  static String _size(num bytes) {
    if (bytes >= 1 << 20) return '${(bytes / (1 << 20)).toStringAsFixed(1)} MB';
    if (bytes >= 1024) return '${(bytes / 1024).round()} KB';
    return '$bytes B';
  }

  @override
  Widget build(BuildContext context) {
    final open = widget.open;
    final header = Container(
      height: 38,
      padding: open ? const EdgeInsets.only(left: 14, right: 6) : EdgeInsets.zero,
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Tern.line))),
      child: Row(
        mainAxisAlignment: open ? MainAxisAlignment.start : MainAxisAlignment.center,
        children: [
          if (open) Expanded(child: Text('Output', style: t(11.5, color: Tern.ink3))),
          if (open && _chosen != null)
            FlowButton(
              dense: true,
              label: 'Open',
              icon: Icons.open_in_new,
              tooltip: 'Open with the system',
              onPressed: () => openExternal(Uri.file(_filePath(_chosen!)).toString()),
            ),
          Tooltip(
            message: open ? 'Hide the output' : 'Show the output',
            child: MouseRegion(
              cursor: SystemMouseCursors.click,
              child: GestureDetector(
                onTap: widget.onToggle,
                child: SizedBox(
                  width: 30,
                  height: 30,
                  child: Icon(open ? Icons.last_page : Icons.first_page, size: 16, color: Tern.muted),
                ),
              ),
            ),
          ),
        ],
      ),
    );

    final files = _files ?? const <Map<String, dynamic>>[];
    return SizedBox(
      key: const ValueKey('output-pane'),
      width: open ? widget.width : 38,
      child: Container(
        color: Tern.panel,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          header,
          if (open) ...[
            Container(
              constraints: const BoxConstraints(maxHeight: 160),
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Tern.line))),
              child: files.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.all(14),
                      child: Text('Nothing produced yet.', style: t(12, color: Tern.muted)),
                    )
                  : ListView(padding: const EdgeInsets.symmetric(vertical: 6), children: [
                      for (final f in files)
                        InkWell(
                          onTap: () {
                            setState(() {
                              _chosen = f['name'] as String;
                              _text = null;
                            });
                            _read();
                          },
                          child: Container(
                            color: f['name'] == _chosen ? Tern.raised : null,
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 5),
                            child: Row(children: [
                              const Icon(Icons.description_outlined, size: 13, color: Tern.faint),
                              const SizedBox(width: 7),
                              Expanded(
                                child: Text(f['name'] as String,
                                    overflow: TextOverflow.ellipsis, style: t(12, color: Tern.ink3, code: true)),
                              ),
                              Text(_size((f['bytes'] ?? 0) as num), style: t(10.5, color: Tern.faint, code: true)),
                            ]),
                          ),
                        ),
                      if (_truncated)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(14, 6, 14, 4),
                          child: Text('Only the newest 200 are listed.', style: t(11, color: Tern.warn)),
                        ),
                    ]),
            ),
            Expanded(
              child: _chosen == null
                  ? const SizedBox()
                  : !_readable.contains(_ext(_chosen!))
                      ? Center(
                          child: FlowButton(
                            label: 'Open ${_chosen!} with the system',
                            icon: Icons.open_in_new,
                            onPressed: () => openExternal(Uri.file(_filePath(_chosen!)).toString()),
                          ),
                        )
                      : SingleChildScrollView(
                          padding: const EdgeInsets.all(16),
                          child: _text == null
                              ? Text('Loading…', style: t(12, color: Tern.muted))
                              : MarkdownView(_ext(_chosen!) == 'md' ? _text : '```\n$_text\n```'),
                        ),
            ),
          ],
        ]),
      ),
    );
  }
}
