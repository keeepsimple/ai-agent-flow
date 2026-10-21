import 'package:flutter/material.dart';

import '../flow.dart';
import '../theme.dart';
import 'bits.dart';

/// App-wide settings: the cost line a task should not cross, and the phone.
class SettingsDialog extends StatefulWidget {
  const SettingsDialog({super.key, required this.flow, this.initial});
  final FlowState flow;

  /// For tests: skips the fetch.
  final Map<String, dynamic>? initial;

  @override
  State<SettingsDialog> createState() => _SettingsDialogState();
}

class _SettingsDialogState extends State<SettingsDialog> {
  Map<String, dynamic>? _settings;
  final _cost = TextEditingController();
  final _chat = TextEditingController();
  final _token = TextEditingController();
  String _note = '';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    if (widget.initial != null) {
      _take(widget.initial!);
    } else {
      widget.flow.api.settings().then((s) { if (mounted) setState(() => _take(s)); }).catchError(widget.flow.fail);
    }
  }

  void _take(Map<String, dynamic> s) {
    _settings = s;
    _cost.text = '${s['costWarnUsd'] ?? 20}';
    _chat.text = ((s['telegram'] as Map?)?['chatId'] ?? '') as String;
  }

  @override
  void dispose() {
    for (final c in [_cost, _chat, _token]) {
      c.dispose();
    }
    super.dispose();
  }

  /// The patch to send, or null with the problem shown when the cost is not a number.
  Map<String, dynamic>? _patch() {
    final cost = double.tryParse(_cost.text.trim());
    if (cost == null || !cost.isFinite || cost < 0) {
      setState(() => _note = 'The cost line must be a number, 0 for none.');
      return null;
    }
    return {
      'costWarnUsd': cost,
      'telegram': {'chatId': _chat.text.trim()},
      if (_token.text.isNotEmpty) 'telegramToken': _token.text,
    };
  }

  Widget _field(String label, TextEditingController c, {String? hint, bool secret = false}) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: t(11, color: Tern.muted)),
          const SizedBox(height: 4),
          TextField(
            controller: c,
            obscureText: secret,
            style: t(12.5, color: Tern.ink, code: true),
            decoration: InputDecoration(
              isDense: true,
              hintText: hint,
              hintStyle: t(12, color: Tern.faint),
              contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Tern.line)),
              enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Tern.line)),
            ),
          ),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final hasToken = _settings?['hasTelegramToken'] == true;
    return AlertDialog(
      backgroundColor: Tern.raised,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      title: Text('Settings', style: t(14, color: Tern.ink)),
      content: SizedBox(
        width: 420,
        child: _settings == null
            ? Text('Loading…', style: t(12, color: Tern.muted))
            : SingleChildScrollView(
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                  _field('Cost line (USD per task)', _cost, hint: '20'),
                  Text('Crossed once, said once: a line in the conversation and a notification. 0 turns it off.', style: t(11, color: Tern.faint)),
                  const SizedBox(height: 14),
                  Text('Phone: a Telegram bot gets questions, gates and finishes; replying answers the question.', style: t(11.5, color: Tern.muted)),
                  const SizedBox(height: 8),
                  _field('Telegram chat id', _chat, hint: '123456789'),
                  _field(hasToken ? 'Bot token (a token is set; leave blank to keep it)' : 'Bot token', _token, secret: true),
                  Row(children: [
                    FlowButton(
                      dense: true,
                      label: 'Test',
                      busy: _busy,
                      onPressed: _busy
                          ? null
                          : () async {
                              final patch = _patch();
                              if (patch == null) return;
                              setState(() => _busy = true);
                              // Save first, so the test uses what is typed.
                              final ok = await widget.flow.run(() async {
                                _take(await widget.flow.api.saveSettings(patch));
                                return widget.flow.api.telegramTest();
                              }, refresh: false);
                              if (!mounted) return;
                              setState(() {
                                _busy = false;
                                _note = ok ? 'Sent "Agent Flow is here." — check the chat.' : '';
                              });
                            },
                    ),
                    const SizedBox(width: 10),
                    Expanded(child: Text(_note, style: t(11, color: Tern.muted))),
                  ]),
                ]),
              ),
      ),
      actions: [
        FlowButton(label: 'Cancel', onPressed: () => Navigator.pop(context)),
        FlowButton(
          label: 'Save',
          tone: Tone.primary,
          onPressed: () async {
            final patch = _patch();
            if (patch == null) return;
            if (await widget.flow.run(() => widget.flow.api.saveSettings(patch), refresh: false) && context.mounted) {
              Navigator.pop(context);
            }
          },
        ),
      ],
    );
  }
}
