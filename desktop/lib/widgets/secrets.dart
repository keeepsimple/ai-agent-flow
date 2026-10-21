import 'package:flutter/material.dart';

import '../flow.dart';
import '../theme.dart';
import 'bits.dart';

/// Before a prompt goes in: if it carries something that looks like a secret,
/// ask once. Returns true to keep them out of the transcript (the server
/// finds, keeps and redacts), false to send as typed, null to cancel.
/// Nothing found means nothing to ask: false.
Future<bool?> askToHideSecrets(
  BuildContext context,
  FlowState flow, {
  required String text,
  required List<String> attachments,
  required bool editsOnly,
}) async {
  List<Map<String, dynamic>> found;
  try {
    found = await flow.api.scanSecrets(text, attachments);
  } catch (_) {
    // A scan that cannot run must not block the send; the guard still stands.
    return false;
  }
  if (found.isEmpty || !context.mounted) return false;
  return showDialog<bool>(
    context: context,
    builder: (_) => SecretsDialog(
      found: found.map((f) => f['name'] as String).toList(),
      editsOnly: editsOnly,
    ),
  );
}

class SecretsDialog extends StatefulWidget {
  const SecretsDialog({super.key, required this.found, required this.editsOnly});
  final List<String> found;
  final bool editsOnly;

  @override
  State<SecretsDialog> createState() => _SecretsDialogState();
}

class _SecretsDialogState extends State<SecretsDialog> {
  bool _keep = true;

  @override
  Widget build(BuildContext context) => AlertDialog(
        backgroundColor: Tern.raised,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Text('This looks like it has secrets in it', style: t(14, color: Tern.ink)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final name in widget.found)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(name, style: t(12, color: Tern.ink, code: true)),
              ),
            const SizedBox(height: 10),
            InkWell(
              onTap: () => setState(() => _keep = !_keep),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                SizedBox(
                  width: 18,
                  height: 18,
                  child: Checkbox(value: _keep, onChanged: (v) => setState(() => _keep = v ?? true)),
                ),
                const SizedBox(width: 8),
                Text('Keep out of the transcript', style: t(12.5, color: Tern.ink)),
              ]),
            ),
            const SizedBox(height: 6),
            Text(
              'Kept values go to the keychain and reach the agent only in its shell, '
              'as \$FLOW_SECRET_<NAME>. The conversation shows {{secret:NAME}} instead.',
              style: t(11.5, color: Tern.muted),
            ),
            if (widget.editsOnly) ...[
              const SizedBox(height: 6),
              Text(
                'Edits only has no shell, so the agent cannot use these.',
                style: t(11.5, color: Tern.warn),
              ),
            ],
          ],
        ),
        actions: [
          FlowButton(label: 'Cancel', onPressed: () => Navigator.pop(context, null)),
          FlowButton(
            label: _keep ? 'Send, keeping them out' : 'Send as typed',
            tone: Tone.primary,
            onPressed: () => Navigator.pop(context, _keep),
          ),
        ],
      );
}
