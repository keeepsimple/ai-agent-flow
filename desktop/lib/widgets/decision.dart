import 'package:flutter/material.dart';

import '../api.dart';
import '../flow.dart';
import '../theme.dart';
import 'bits.dart';

const _gateWords = {
  'spec': 'The spec is written. Read it before the plan gets built on top of it.',
  'plan': 'The plan is written. Approving this starts the implementation.',
};

/// The warn-bordered card for anything blocking on you.
///
/// A question is already in the transcript directly above this, so it is not
/// repeated here. A gate has no transcript entry of its own, so its line does.
class Decision extends StatefulWidget {
  const Decision({super.key, required this.task, required this.flow});
  final Task task;
  final FlowState flow;

  @override
  State<Decision> createState() => _DecisionState();
}

class _DecisionState extends State<Decision> {
  final _text = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    // The button label and whether it is live both read the box.
    _text.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _run(Future<dynamic> Function() action) async {
    setState(() => _busy = true);
    final ok = await widget.flow.run(action);
    if (!mounted) return;
    if (ok) _text.clear();
    setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final gate = task.status == 'awaiting_approval';
    final question = task.openQuestion;
    if (!gate && question == null) return const SizedBox.shrink();

    return Panel(
      colour: Tern.warnBg,
      border: Tern.warnLine,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(gate ? Icons.warning_amber_rounded : Icons.help_outline,
                size: 15, color: Tern.warn),
            const SizedBox(width: 7),
            Text(
              gate
                  ? 'Your call: ${phaseLabels[task.awaitingPhase] ?? task.awaitingPhase}'
                  : 'Tern needs an answer',
              style: t(13, color: Tern.warn, weight: FontWeight.w500),
            ),
          ]),
          if (gate) ...[
            const SizedBox(height: 8),
            Text(_gateWords[task.awaitingPhase] ?? '', style: t(13, color: Tern.ink2)),
          ],
          const SizedBox(height: 10),
          Container(
            constraints: const BoxConstraints(minHeight: 56, maxHeight: 220),
            decoration: BoxDecoration(
              color: Tern.page,
              border: Border.all(color: Tern.lineStrong),
              borderRadius: BorderRadius.circular(10),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            child: TextField(
              controller: _text,
              maxLines: null,
              style: t(12.5, color: Tern.ink2, code: true),
              decoration: InputDecoration.collapsed(
                hintText: gate
                    ? 'Optional. Anything here overrides the document.'
                    : 'Your answer.',
                hintStyle: t(12.5, color: Tern.faint),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: gate
                ? [
                    FlowButton(
                      label: _text.text.trim().isEmpty ? 'Approve' : 'Approve with feedback',
                      tone: Tone.primary,
                      busy: _busy,
                      onPressed: () => _run(() => widget.flow.api
                          .approve(task.id, true, _text.text.trim())),
                    ),
                    FlowButton(
                      label: 'Send it back',
                      tone: Tone.danger,
                      busy: _busy,
                      onPressed: () => _run(() => widget.flow.api
                          .approve(task.id, false, _text.text.trim())),
                    ),
                  ]
                : [
                    FlowButton(
                      label: 'Send answer',
                      tone: Tone.primary,
                      busy: _busy,
                      onPressed: _text.text.trim().isEmpty && !_busy
                          ? null
                          : () => _run(() => widget.flow.api.answer(
                              task.id, question!['id'] as String, _text.text.trim())),
                    ),
                  ],
          ),
        ],
      ),
    );
  }
}
