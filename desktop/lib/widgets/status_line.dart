import 'package:flutter/material.dart';

import '../api.dart';
import '../status.dart';
import '../theme.dart';
import 'bits.dart';

/// One line under the header: did, and needs. Click it to go to that message.
class StatusLine extends StatelessWidget {
  const StatusLine({super.key, required this.task, required this.onJump});
  final Task task;
  final VoidCallback onJump;

  @override
  Widget build(BuildContext context) {
    final did = didOf(task);
    final needs = needsOf(task);
    if (did == null && needs == null) return const SizedBox.shrink();
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onJump,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 7, 16, 7),
          decoration: const BoxDecoration(
            color: Tern.panel,
            border: Border(bottom: BorderSide(color: Tern.line)),
          ),
          child: Row(children: [
            if (did != null) ...[
              Text(task.running ? 'Doing' : 'Did', style: t(10.5, color: Tern.faint, weight: FontWeight.w600)),
              const SizedBox(width: 8),
              Expanded(
                flex: needs == null ? 1 : 3,
                child: Text(did, maxLines: 1, overflow: TextOverflow.ellipsis, style: t(11.5, color: Tern.muted)),
              ),
            ],
            if (did != null && needs != null) const SizedBox(width: 18),
            if (needs != null) ...[
              Text('Needs', style: t(10.5, color: Tern.warn, weight: FontWeight.w600)),
              const SizedBox(width: 8),
              Expanded(
                flex: 2,
                child: Text(needs, maxLines: 1, overflow: TextOverflow.ellipsis, style: t(11.5, color: Tern.warn)),
              ),
            ],
          ]),
        ),
      ),
    );
  }
}
