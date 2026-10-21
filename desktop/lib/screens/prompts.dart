import 'package:flutter/material.dart';

import '../flow.dart';
import '../theme.dart';
import '../widgets/bits.dart';

/// What each agent is told, editable. Overrides live beside the data; the
/// defaults ship with the app. Reset puts the default back; the last three
/// saves are kept so a bad edit is not the end of a good one.
class PromptsScreen extends StatefulWidget {
  const PromptsScreen({super.key, required this.flow, this.initial});
  final FlowState flow;

  /// For tests: skips the fetch.
  final List<Map<String, dynamic>>? initial;

  @override
  State<PromptsScreen> createState() => _PromptsScreenState();
}

class _PromptsScreenState extends State<PromptsScreen> {
  List<Map<String, dynamic>>? _prompts;
  String? _name;
  final _text = TextEditingController();
  bool _busy = false;
  String _note = '';

  Map<String, dynamic>? get _current =>
      _prompts?.where((p) => p['name'] == _name).firstOrNull;
  String get _shown => (_current?['custom'] ?? _current?['default'] ?? '') as String;
  bool get _dirty => _text.text != _shown;

  @override
  void initState() {
    super.initState();
    _text.addListener(() => setState(() {}));
    if (widget.initial != null) {
      _take(widget.initial!);
    } else {
      _load();
    }
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  void _take(List<Map<String, dynamic>> list) {
    _prompts = list;
    _name ??= list.firstOrNull?['name'] as String?;
    _text.text = _shown;
  }

  Future<void> _load() async {
    try {
      final list = await widget.flow.api.prompts();
      if (!mounted) return;
      setState(() => _take(list));
    } catch (err) {
      widget.flow.fail(err);
    }
  }

  void _pick(String name) {
    setState(() {
      _name = name;
      _note = '';
      _text.text = _shown;
    });
  }

  Future<void> _do(Future<dynamic> Function() action, String done) async {
    setState(() => _busy = true);
    final ok = await widget.flow.run(action, refresh: false);
    if (!mounted) return;
    if (ok) {
      await _load();
      if (!mounted) return;
      setState(() => _note = done);
    }
    setState(() => _busy = false);
  }

  Future<void> _history() async {
    final name = _name;
    if (name == null) return;
    List<Map<String, dynamic>> kept;
    try {
      kept = await widget.flow.api.promptHistory(name);
    } catch (err) {
      widget.flow.fail(err);
      return;
    }
    if (!mounted) return;
    final chosen = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Tern.raised,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Text('Earlier saves of $name', style: t(14, color: Tern.ink)),
        content: SizedBox(
          width: 560,
          child: kept.isEmpty
              ? Text('Nothing kept yet. The last three saves show up here.', style: t(12.5, color: Tern.muted))
              : Column(mainAxisSize: MainAxisSize.min, children: [
                  for (final h in kept)
                    ListTile(
                      dense: true,
                      title: Text('${h['n']} save${h['n'] == 1 ? '' : 's'} ago', style: t(12, color: Tern.ink)),
                      subtitle: Text(
                        (h['text'] as String).split('\n').take(3).join(' · '),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: t(11, color: Tern.muted, code: true),
                      ),
                      trailing: FlowButton(
                        dense: true,
                        label: 'Put in editor',
                        onPressed: () => Navigator.pop(context, h['text'] as String),
                      ),
                    ),
                ]),
        ),
        actions: [FlowButton(label: 'Close', onPressed: () => Navigator.pop(context, null))],
      ),
    );
    if (chosen != null && mounted) setState(() => _text.text = chosen);
  }

  @override
  Widget build(BuildContext context) {
    final prompts = _prompts;
    if (prompts == null) {
      return Center(child: Text('Loading…', style: t(12.5, color: Tern.muted)));
    }
    final current = _current;
    return Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SizedBox(
        width: 236,
        child: ListView(padding: const EdgeInsets.fromLTRB(14, 18, 10, 18), children: [
          Padding(
            padding: const EdgeInsets.only(left: 10, bottom: 8),
            child: Text('Prompts', style: t(12, color: Tern.muted)),
          ),
          for (final p in prompts)
            _Name(
              name: p['name'] as String,
              about: p['about'] as String? ?? '',
              custom: p['custom'] != null,
              selected: p['name'] == _name,
              onTap: () => _pick(p['name'] as String),
            ),
        ]),
      ),
      const VerticalDivider(width: 1, color: Tern.line),
      Expanded(
        child: current == null
            ? const SizedBox()
            : Padding(
                padding: const EdgeInsets.fromLTRB(22, 18, 22, 16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Text(current['name'] as String, style: t(14, color: Tern.ink, weight: FontWeight.w600)),
                    const SizedBox(width: 10),
                    if (current['custom'] != null)
                      Text('edited', style: t(11, color: Tern.warn))
                    else
                      Text('default', style: t(11, color: Tern.faint)),
                  ]),
                  const SizedBox(height: 4),
                  Text(current['about'] as String? ?? '', style: t(12, color: Tern.muted)),
                  const SizedBox(height: 6),
                  Text(
                    'Gets: ${((current['placeholders'] as List?) ?? const []).map((p) => '{{$p}}').join(', ')}'
                    '${((current['placeholders'] as List?) ?? const []).isEmpty ? 'nothing' : ''}'
                    '  ·  {{#if x}}…{{else}}…{{/if}} works too',
                    style: t(11, color: Tern.faint, code: true),
                  ),
                  const SizedBox(height: 12),
                  Expanded(
                    child: Container(
                      decoration: BoxDecoration(
                        color: Tern.raised,
                        border: Border.all(color: Tern.line),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      padding: const EdgeInsets.all(12),
                      child: TextField(
                        controller: _text,
                        maxLines: null,
                        expands: true,
                        textAlignVertical: TextAlignVertical.top,
                        style: t(12, color: Tern.ink, code: true),
                        decoration: const InputDecoration.collapsed(hintText: ''),
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(children: [
                    FlowButton(
                      label: 'Save',
                      tone: Tone.primary,
                      busy: _busy,
                      onPressed: _dirty && !_busy
                          ? () => _do(() => widget.flow.api.savePrompt(_name!, _text.text), 'Saved. The next run gets it.')
                          : null,
                    ),
                    const SizedBox(width: 8),
                    if (current['custom'] != null)
                      FlowButton(
                        label: 'Reset to default',
                        onPressed: _busy ? null : () => _do(() => widget.flow.api.resetPrompt(_name!), 'Back to the default.'),
                      ),
                    if (current['custom'] != null) const SizedBox(width: 8),
                    FlowButton(label: 'History', icon: Icons.history, onPressed: _busy ? null : _history),
                    const SizedBox(width: 12),
                    Expanded(child: Text(_note, style: t(11.5, color: Tern.muted))),
                  ]),
                ]),
              ),
      ),
    ]);
  }
}

class _Name extends StatelessWidget {
  const _Name({required this.name, required this.about, required this.custom, required this.selected, required this.onTap});
  final String name;
  final String about;
  final bool custom;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Tooltip(
        message: about,
        waitDuration: const Duration(milliseconds: 500),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(7),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(
              color: selected ? Tern.raised : null,
              borderRadius: BorderRadius.circular(7),
            ),
            child: Row(children: [
              Expanded(child: Text(name, style: t(12.5, color: selected ? Tern.ink : Tern.muted, code: true))),
              if (custom)
                Container(width: 6, height: 6, decoration: const BoxDecoration(color: Tern.warn, shape: BoxShape.circle)),
            ]),
          ),
        ),
      );
}
