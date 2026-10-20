import 'dart:io';

import 'package:flutter/material.dart';

import '../api.dart';
import '../flow.dart';
import '../theme.dart';
import 'bits.dart';

/// The bar across the top. Carries what the current screen can do, and
/// nothing it cannot.
class Header extends StatelessWidget {
  const Header({
    super.key,
    required this.flow,
    required this.task,
    required this.tab,
    required this.onTab,
    required this.onBack,
    required this.accent,
    required this.onAccent,
    required this.onDropped,
    required this.onDeleted,
  });

  final FlowState flow;
  final Task? task;
  final String tab;
  final void Function(String) onTab;
  final VoidCallback onBack;
  final Accent accent;
  final void Function(Accent) onAccent;
  final VoidCallback onDropped;
  final VoidCallback onDeleted;

  @override
  Widget build(BuildContext context) {
    // The window has no title bar of its own any more, so this row sits where
    // one would be. AppKit puts the traffic lights at x 9..69 with their
    // centres 16 from the top of the window, so the content is laid out in a
    // 32-high band from the top rather than down the middle of the bar:
    // centred in the bar it sat 8pt below the lights, which is what showed.
    return Container(
      height: 44,
      padding: EdgeInsets.only(
        left: Platform.isMacOS ? 80 : 14,
        right: 14,
        bottom: Platform.isMacOS ? 12 : 0,
      ),
      decoration: const BoxDecoration(
        // A shade above the page, not level with it. At panel colour the bar
        // and the body were the same dark, and the hairline between them read
        // as a stray line rather than the edge of a toolbar.
        color: Tern.raised,
        border: Border(bottom: BorderSide(color: Tern.lineStrong)),
      ),
      child: Row(
        children: [
          if (task != null)
            _IconButton(
              icon: Icons.arrow_back,
              tooltip: 'Sessions',
              onTap: onBack,
            )
          else ...[
            const Mark(size: 20),
            const SizedBox(width: 9),
            Padding(
              padding: const EdgeInsets.only(right: 10),
              child: Text(
                'Agent Flow',
                style: t(13, color: Tern.ink, weight: FontWeight.w600),
              ),
            ),
          ],
          if (task != null) ...[
            const SizedBox(width: 10),
            StatusDot(task!.status),
            const SizedBox(width: 10),
            Flexible(
              child: Text(
                task!.title,
                overflow: TextOverflow.ellipsis,
                style: t(13, color: Tern.ink, weight: FontWeight.w500),
              ),
            ),
            const SizedBox(width: 10),
            Text(
              statusWords(
                Task2(task!.status, task!.phase, task!.awaitingPhase),
              ),
              style: t(11.5, color: Tern.muted),
            ),
            const SizedBox(width: 14),
            _Tabs(tab: tab, onTab: onTab),
          ],
          const Spacer(),
          if (task != null) ...[
            if (task!.active)
              FlowButton(
                dense: true,
                label: 'Stop',
                tone: Tone.danger,
                icon: Icons.stop_circle_outlined,
                onPressed: () => flow.run(() => flow.api.cancel(task!.id)),
                tooltip: 'Signals the whole process tree, not just the wrapper',
              ),
            if (task!.status == 'failed')
              FlowButton(
                dense: true,
                label: 'Retry',
                icon: Icons.refresh,
                onPressed: () => flow.run(() => flow.api.retry(task!.id)),
              ),
            if (!task!.active) ...[
              const SizedBox(width: 7),
              if (task!.root != null)
                FlowButton(
                  dense: true,
                  label: 'Drop worktree',
                  icon: Icons.folder_off_outlined,
                  tooltip: 'Frees the checkout. The conversation and the branches stay.',
                  onPressed: () async {
                    if (await flow.run(() => flow.api.dropWorktree(task!.id))) {
                      onDropped();
                    }
                  },
                ),
              const SizedBox(width: 7),
              FlowButton(
                dense: true,
                label: 'Delete',
                tone: Tone.danger,
                icon: Icons.delete_outline,
                tooltip: 'Throws the conversation away too. The branches stay.',
                onPressed: () => _confirmDelete(context),
              ),
            ],
          ] else ...[
            FlowButton(
              dense: true,
              label: 'Test browser',
              icon: Icons.travel_explore,
              tooltip:
                  'Opens the Chrome this tool owns, signed in from your own',
              onPressed: () async {
                try {
                  final out = await flow.api.openBrowser();
                  if (out['blocked'] == true) {
                    flow.fail(ApiError(out['why'] as String));
                  } else if (out['yourChrome'] == false) {
                    // The window opens either way. This is about whether it
                    // could start from the session you already have.
                    flow.fail(ApiError(
                      'The window is open, but signed out: macOS will not let '
                      'this app read your own Chrome. Grant it Full Disk Access '
                      'in System Settings, delete the browser profile, and press '
                      'this again.',
                    ));
                  }
                } catch (err) {
                  flow.fail(err);
                }
              },
            ),
            const SizedBox(width: 8),
            _AccentPicker(accent: accent, onPick: onAccent),
          ],
          const SizedBox(width: 10),
          Tooltip(
            message: flow.live ? 'Connected' : 'Reconnecting…',
            child: Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(
                color: flow.live ? Tern.ok : Tern.faint,
                shape: BoxShape.circle,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmDelete(BuildContext context) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Tern.raised,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Text('Delete this conversation?', style: t(14, color: Tern.ink)),
        content: Text(
          'The conversation and the documents go. The branches stay: they are the work.',
          style: t(12.5, color: Tern.muted),
        ),
        actions: [
          FlowButton(
            label: 'Keep',
            onPressed: () => Navigator.pop(context, false),
          ),
          FlowButton(
            label: 'Delete it',
            tone: Tone.danger,
            onPressed: () => Navigator.pop(context, true),
          ),
        ],
      ),
    );
    if (yes != true) return;
    if (await flow.run(() => flow.api.removeTask(task!.id), refresh: false)) {
      onDeleted();
    }
  }
}

class _Tabs extends StatelessWidget {
  const _Tabs({required this.tab, required this.onTab});
  final String tab;
  final void Function(String) onTab;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(3),
    decoration: BoxDecoration(
      color: Tern.raised,
      borderRadius: BorderRadius.circular(16),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final name in ['workspace', 'review'])
          GestureDetector(
            onTap: () => onTab(name),
            child: MouseRegion(
              cursor: SystemMouseCursors.click,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 13,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: tab == name ? Tern.selected : Colors.transparent,
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Text(
                  name == 'workspace' ? 'Workspace' : 'Review',
                  style: t(12, color: tab == name ? Tern.ink : Tern.muted),
                ),
              ),
            ),
          ),
      ],
    ),
  );
}

class _AccentPicker extends StatelessWidget {
  const _AccentPicker({required this.accent, required this.onPick});
  final Accent accent;
  final void Function(Accent) onPick;

  @override
  Widget build(BuildContext context) => Container(
    // One control, not four loose dots.
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 5),
    decoration: BoxDecoration(
      color: Tern.raised,
      border: Border.all(color: Tern.line),
      borderRadius: BorderRadius.circular(14),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final option in Accent.values)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 3),
            child: Tooltip(
              message: option.label,
              child: MouseRegion(
                cursor: SystemMouseCursors.click,
                child: GestureDetector(
                  onTap: () => onPick(option),
                  child: Container(
                    width: 13,
                    height: 13,
                    decoration: BoxDecoration(
                      color: option.color,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: option == accent ? Tern.ink : Colors.transparent,
                        width: 2,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    ),
  );
}

class _IconButton extends StatelessWidget {
  const _IconButton({required this.icon, required this.onTap, this.tooltip});
  final IconData icon;
  final VoidCallback onTap;
  final String? tooltip;

  @override
  Widget build(BuildContext context) => Tooltip(
    message: tooltip ?? '',
    child: MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: 30,
          height: 30,
          alignment: Alignment.center,
          child: Icon(icon, size: 17, color: Tern.muted),
        ),
      ),
    ),
  );
}
