import 'dart:io';

import 'package:flutter/material.dart';

import '../api.dart';
import '../flow.dart';
import '../theme.dart';
import 'bits.dart';
import 'markdown_view.dart';

/// The bar across the top. Carries what the current screen can do, and
/// nothing it cannot.
class Header extends StatelessWidget {
  const Header({
    super.key,
    required this.flow,
    required this.sidebarOpen,
    required this.fullScreen,
    required this.onToggleSidebar,
    required this.task,
    required this.tab,
    required this.onTab,
    required this.onBack,
    required this.accent,
    required this.onAccent,
    required this.onDropped,
    required this.onDeleted,
    this.onPrompts,
    this.promptsOpen = false,
  });

  /// Opens the Prompts screen; absent where there is nowhere to open it.
  final VoidCallback? onPrompts;
  final bool promptsOpen;

  final FlowState flow;
  final bool sidebarOpen;

  /// Full screen has no traffic lights, so nothing to leave room for.
  final bool fullScreen;
  final VoidCallback onToggleSidebar;
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
    // This row is the window's title bar. A unified toolbar makes that bar
    // 52pt tall and puts the traffic lights in the middle of it, at x 19..79
    // with their centres at 26 — so an ordinary centred row lines up, and the
    // inset only has to clear the lights.
    return Container(
      height: 52,
      padding: EdgeInsets.only(
        left: Platform.isMacOS && !fullScreen ? 90 : 14,
        right: 14,
      ),
      decoration: const BoxDecoration(
        // A shade above the page, not level with it. At panel colour the bar
        // and the body were the same dark, and the hairline between them read
        // as a stray line rather than the edge of a toolbar.
        //
        // The gradient plus the lit top edge is what gives it thickness. A drop
        // shadow would be the obvious move but the bar is a Column sibling, so
        // the body paints over it; the gradient does the same job in paint
        // order that cannot lose.
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Tern.selected, Tern.raised],
        ),
        border: Border(
          top: BorderSide(color: Color(0x14FFFFFF)),
          bottom: BorderSide(color: Tern.lineStrong),
        ),
      ),
      child: Row(
        children: [
          _IconButton(
            icon: sidebarOpen ? Icons.menu_open : Icons.menu,
            tooltip: sidebarOpen
                ? 'Hide the sidebar  (${Platform.isMacOS ? 'Cmd' : 'Ctrl'}+\\)'
                : 'Show the sidebar  (${Platform.isMacOS ? 'Cmd' : 'Ctrl'}+\\)',
            onTap: onToggleSidebar,
          ),
          const SizedBox(width: 6),
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
            if (task!.interrupted)
              FlowButton(
                dense: true,
                label: 'Continue',
                tone: Tone.primary,
                icon: Icons.play_arrow,
                tooltip: 'Picks the session back up where it was cut off',
                onPressed: () => flow.run(() => flow.api.resume(task!.id)),
              ),
            if (!task!.active) ...[
              const SizedBox(width: 7),
              if (task!.root != null)
                AsyncButton(
                  dense: true,
                  label: 'Drop worktree',
                  icon: Icons.folder_off_outlined,
                  tooltip: 'Frees the checkout. The conversation and the branches stay.',
                  run: () async {
                    if (await flow.run(() => flow.api.dropWorktree(task!.id))) {
                      onDropped();
                      flow.loadDisk();
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
            if (onPrompts != null) ...[
              FlowButton(
                dense: true,
                label: promptsOpen ? 'Board' : 'Prompts',
                icon: promptsOpen
                    ? Icons.view_agenda_outlined
                    : Icons.edit_note,
                tooltip: promptsOpen
                    ? 'Back to the board'
                    : 'What each agent is told, editable',
                onPressed: onPrompts,
              ),
              const SizedBox(width: 8),
            ],
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
                  } else if (out['yourChrome'] == false && context.mounted) {
                    await _askForFullDisk(context, out['profile'] as String?);
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

  /// macOS never prompts for Full Disk Access: unlike the camera or the
  /// microphone there is no API to ask, so an app can only say what is
  /// missing and open the page where it is given.
  Future<void> _askForFullDisk(BuildContext context, String? profile) async {
    final open = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Tern.raised,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Text(
          'The browser opened, but signed out',
          style: t(14, color: Tern.ink),
        ),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 430),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'macOS will not let this app read the Chrome you already use, '
                'so there is no session to copy. It never asks for that by '
                'itself — the permission has to be given by hand.',
                style: t(12.5, color: Tern.muted, height: 1.5),
              ),
              const SizedBox(height: 12),
              Text(
                '1.  Add Agent Flow to Full Disk Access\n'
                '2.  Delete the browser profile below\n'
                '3.  Press Test browser again',
                style: t(12.5, color: Tern.ink3, height: 1.7),
              ),
              if (profile != null) ...[
                const SizedBox(height: 10),
                SelectableText(
                  profile,
                  style: t(11, color: Tern.faint, code: true),
                ),
              ],
              const SizedBox(height: 10),
              Text(
                'Rebuilding the app changes its signature, so the permission '
                'has to be given again after each build.',
                style: t(11.5, color: Tern.faint, height: 1.5),
              ),
            ],
          ),
        ),
        actions: [
          FlowButton(
            label: 'Not now',
            onPressed: () => Navigator.pop(context, false),
          ),
          FlowButton(
            label: 'Open Settings',
            tone: Tone.primary,
            onPressed: () => Navigator.pop(context, true),
          ),
        ],
      ),
    );
    if (open == true) {
      await openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
      );
    }
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
      color: Tern.page,
      border: Border.all(color: Tern.line),
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
              child: AnimatedContainer(
                duration: smooth,
                curve: ease,
                padding: const EdgeInsets.symmetric(
                  horizontal: 13,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: tab == name ? Tern.selected : Colors.transparent,
                  border: tab == name
                      ? raised(Tern.lineStrong)
                      : Border.all(color: Colors.transparent),
                  borderRadius: BorderRadius.circular(13),
                  boxShadow: tab == name ? e1 : null,
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
                  child: AnimatedScale(
                    duration: smooth,
                    curve: ease,
                    scale: option == accent ? 1.15 : 1,
                    child: AnimatedContainer(
                      duration: smooth,
                      curve: ease,
                      width: 13,
                      height: 13,
                      decoration: BoxDecoration(
                        color: option.color,
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: option == accent
                              ? Tern.ink
                              : Colors.transparent,
                          width: 2,
                        ),
                        boxShadow: option == accent
                            ? [
                                BoxShadow(
                                  color: option.color.withValues(alpha: 0.65),
                                  blurRadius: 12,
                                  spreadRadius: -2,
                                ),
                              ]
                            : null,
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
