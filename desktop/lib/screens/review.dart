import 'package:flutter/material.dart';

import '../api.dart';
import '../flow.dart';
import '../theme.dart';
import '../widgets/bits.dart';
import '../widgets/diff_view.dart';
import '../widgets/markdown_view.dart';

/// What changed, what the review made of it, and the only buttons that touch
/// a remote. Nothing here happens on its own.
class ReviewScreen extends StatefulWidget {
  const ReviewScreen({super.key, required this.flow, required this.task});
  final FlowState flow;
  final Task task;

  @override
  State<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends State<ReviewScreen> {
  List<Map<String, dynamic>> _diff = const [];
  List<Map<String, dynamic>> _git = const [];
  String? _file;
  String _busy = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final diff = await widget.flow.api.diff(widget.task.id);
      final git = await widget.flow.api.gitState(widget.task.id);
      if (!mounted) return;
      setState(() {
        _diff = diff;
        _git = git;
        _file ??= _files().isEmpty ? null : _files().first['path'] as String;
      });
    } catch (err) {
      widget.flow.fail(err);
    }
  }

  List<Map<String, dynamic>> _files() => [
        for (final repo in _diff)
          for (final file in (repo['files'] as List?) ?? const [])
            {...(file as Map).cast<String, dynamic>(), 'repo': repo['repo']},
      ];

  Future<void> _act(String key, Future<dynamic> Function() action) async {
    setState(() => _busy = key);
    await widget.flow.run(action);
    if (!mounted) return;
    setState(() => _busy = '');
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final files = _files();
    final chosen = files.where((f) => f['path'] == _file).firstOrNull;
    final review = widget.task.docs['review.md'] as String?;

    return Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SizedBox(
        width: 268,
        child: Container(
          color: Tern.panel,
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
            children: [
              Text('Changed files', style: t(11, color: Tern.muted)),
              const SizedBox(height: 8),
              if (files.isEmpty)
                Text('Nothing changed.', style: t(11.5, color: Tern.faint))
              else
                for (final file in files)
                  MouseRegion(
                    cursor: SystemMouseCursors.click,
                    child: GestureDetector(
                      onTap: () => setState(() => _file = file['path'] as String),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                        margin: const EdgeInsets.only(bottom: 2),
                        decoration: BoxDecoration(
                          color: file['path'] == _file ? Tern.selected : Colors.transparent,
                          borderRadius: BorderRadius.circular(7),
                        ),
                        child: Row(children: [
                          Expanded(
                            child: Text(
                              file['path'] as String,
                              overflow: TextOverflow.ellipsis,
                              style: t(11.5,
                                  color: file['path'] == _file ? Tern.ink : Tern.ink3,
                                  code: true),
                            ),
                          ),
                          Text('+${file['added'] ?? 0}',
                              style: t(10.5, color: Tern.ok, code: true)),
                          const SizedBox(width: 5),
                          Text('-${file['removed'] ?? 0}',
                              style: t(10.5, color: Tern.bad, code: true)),
                        ]),
                      ),
                    ),
                  ),
            ],
          ),
        ),
      ),
      const VerticalDivider(width: 1, color: Tern.line),
      Expanded(
        flex: 3,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Container(
            height: 38,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            alignment: Alignment.centerLeft,
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: Tern.line)),
            ),
            child: Text(chosen?['path'] as String? ?? 'Diff',
                overflow: TextOverflow.ellipsis, style: t(11.5, color: Tern.ink3, code: true)),
          ),
          Expanded(
            child: chosen == null
                ? Center(child: Text('Nothing to show.', style: t(12, color: Tern.muted)))
                : (chosen['patch'] == null
                    ? Center(
                        child: Text(
                          'Too large to show: ${((chosen['bytes'] ?? 0) as num) ~/ 1024} KB.',
                          style: t(12, color: Tern.muted),
                        ),
                      )
                    : DiffView(chosen['patch'] as String?)),
          ),
        ]),
      ),
      const VerticalDivider(width: 1, color: Tern.line),
      SizedBox(
        width: 400,
        child: Container(
          color: Tern.panel,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              for (final repo in _git) ...[
                RepoCard(
                  repo: repo,
                  busy: _busy,
                  onPush: () => _act('push:${repo['repo']}',
                      () => widget.flow.api.push(widget.task.id, repo['repo'] as String)),
                  onPushBase: () => _act('base:${repo['repo']}',
                      () => widget.flow.api
                          .push(widget.task.id, repo['repo'] as String, base: true)),
                  onMerge: () => _act('merge:${repo['repo']}',
                      () => widget.flow.api.merge(widget.task.id, repo['repo'] as String)),
                  onCatchUp: () => _act('catch:${repo['repo']}',
                      () => widget.flow.api.catchUp(widget.task.id, repo['repo'] as String)),
                ),
                const SizedBox(height: 12),
              ],
              if (review != null) ...[
                Text('Self review', style: t(11, color: Tern.muted)),
                const SizedBox(height: 8),
                MarkdownView(review),
              ],
            ],
          ),
        ),
      ),
    ]);
  }
}

class RepoCard extends StatelessWidget {
  const RepoCard({
    super.key,
    required this.repo,
    required this.busy,
    required this.onPush,
    required this.onPushBase,
    required this.onMerge,
    required this.onCatchUp,
  });

  final Map<String, dynamic> repo;
  final String busy;
  final VoidCallback onPush;
  final VoidCallback onPushBase;
  final VoidCallback onMerge;
  final VoidCallback onCatchUp;

  @override
  Widget build(BuildContext context) {
    final name = repo['repo'] as String;
    final base = repo['base'] as String? ?? 'main';
    final ahead = (repo['ahead'] ?? 0) as int;
    final behind = (repo['behind'] ?? 0) as int;
    final unpushed = repo['unpushed'] as int?;
    final baseUnpushed = (repo['baseUnpushed'] ?? 0) as int;
    final blocked = repo['mergeBlockedBy'] as String?;
    final pipeline = repo['pipeline'] as Map?;
    final reviewUrl = repo['reviewUrl'] as String?;

    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(
              child: Text(name, style: t(12.5, color: Tern.ink, weight: FontWeight.w500)),
            ),
            if (behind > 0)
              Tooltip(
                message: '$base has moved on by $behind commits',
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.warning_amber_rounded, size: 13, color: Tern.warn),
                  const SizedBox(width: 4),
                  Text('$behind behind $base', style: t(11, color: Tern.warn)),
                ]),
              ),
          ]),
          const SizedBox(height: 4),
          Text(repo['branch'] as String? ?? '',
              overflow: TextOverflow.ellipsis, style: t(11, color: Tern.muted, code: true)),
          const SizedBox(height: 10),
          if (pipeline != null) _pipeline(pipeline),
          Wrap(spacing: 7, runSpacing: 7, children: [
            FlowButton(
              label: unpushed == null
                  ? 'Push'
                  : (unpushed == 0 ? 'Pushed' : 'Push ($unpushed)'),
              icon: Icons.cloud_upload_outlined,
              busy: busy == 'push:$name',
              onPressed: repo['remote'] == null || unpushed == 0 ? null : onPush,
              tooltip: repo['remote'] == null ? 'No remote on this repo' : null,
            ),
            if (baseUnpushed > 0)
              FlowButton(
                label: 'Push $base ($baseUnpushed)',
                busy: busy == 'base:$name',
                onPressed: onPushBase,
              ),
            FlowButton(
              label: 'Merge into $base',
              tone: Tone.primary,
              busy: busy == 'merge:$name',
              // Being behind is no longer a reason to refuse: the agent brings
              // the base in first, which is what makes the merge itself a
              // fast-forward. It stops and says so if the checkout is busy.
              onPressed: ahead == 0 ? null : onMerge,
              tooltip: ahead == 0
                  ? 'Nothing on this branch that $base does not have'
                  : 'The agent brings $base in, runs the checks, then fast-forwards'
                      '${behind > 0 ? ' — $behind commits to catch up on first' : ''}',
            ),
            if (behind > 0)
              FlowButton(
                label: 'Catch up with $base',
                busy: busy == 'catch:$name',
                onPressed: onCatchUp,
                tooltip: 'Runs an agent to merge $base in, inside the worktree',
              ),
            if (reviewUrl != null)
              FlowButton(
                label: 'Open MR',
                icon: Icons.open_in_new,
                onPressed: () => openExternal(reviewUrl),
              ),
          ]),
          if (blocked != null) ...[
            const SizedBox(height: 8),
            Text(blocked, style: t(11, color: Tern.warn)),
          ],
        ],
      ),
    );
  }

  Widget _pipeline(Map pipeline) {
    final status = (pipeline['status'] ?? 'unknown') as String;
    final colour = switch (status) {
      'success' => Tern.ok,
      'failed' => Tern.bad,
      'running' || 'pending' => Tern.warn,
      _ => Tern.muted,
    };
    final url = pipeline['url'] as String?;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: MouseRegion(
        cursor: url == null ? SystemMouseCursors.basic : SystemMouseCursors.click,
        child: GestureDetector(
          onTap: url == null ? null : () => openExternal(url),
          child: Row(children: [
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(color: colour, shape: BoxShape.circle),
            ),
            const SizedBox(width: 7),
            Text('CI $status', style: t(11, color: colour)),
            if (pipeline['hint'] != null) ...[
              const SizedBox(width: 8),
              Expanded(
                child: Text(pipeline['hint'] as String,
                    overflow: TextOverflow.ellipsis, style: t(10.5, color: Tern.faint, code: true)),
              ),
            ],
          ]),
        ),
      ),
    );
  }
}
