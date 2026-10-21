import 'dart:async';

import 'package:flutter/foundation.dart';

import 'api.dart';

/// Everything the screens read. One store, because the server is one server
/// and the whole UI is a view of it.
class FlowState extends ChangeNotifier {
  FlowState(this.api);
  final Api api;

  List<Task>? tasks;
  List<Map<String, dynamic>> repos = const [];
  List<String> roots = const [];
  Map<String, dynamic>? options;
  Map<String, dynamic>? defaults;
  Task? detail;
  String? selected;
  bool live = false;
  String? error;

  /// What the worktrees are costing, measured by the server. Null until it
  /// has been asked for: the measurement walks gigabytes and takes seconds.
  Map<String, dynamic>? disk;

  /// Which workspace the board is showing. Null means all of them.
  String? workspace;

  /// A repo chosen on the board; null for all of the workspace.
  String? repoFilter;

  StreamSubscription<dynamic>? _events;
  Timer? _errorTimer;
  Timer? _retry;

  bool _gone = false;

  /// An error that waits to be clicked outlives whatever it was about.
  ///
  /// A request that fails after the screen has gone must not bring the store
  /// back to life: notifying a disposed listener throws, and the timer would
  /// outlive everything that could cancel it.
  void fail(Object err) {
    if (_gone) return;
    error = err is ApiError ? err.message : err.toString();
    notifyListeners();
    _errorTimer?.cancel();
    _errorTimer = Timer(const Duration(seconds: 5), () {
      error = null;
      notifyListeners();
    });
  }

  void clearError() {
    _errorTimer?.cancel();
    error = null;
    notifyListeners();
  }

  Future<void> loadState() async {
    try {
      final s = await api.state();
      tasks = ((s['tasks'] as List?) ?? [])
          .map((t) => Task((t as Map).cast<String, dynamic>()))
          .toList();
      repos = ((s['repos'] as List?) ?? [])
          .map((r) => (r as Map).cast<String, dynamic>())
          .toList();
      roots = ((s['roots'] as List?) ?? []).cast<String>();
      options = (s['options'] as Map?)?.cast<String, dynamic>();
      defaults = (s['defaults'] as Map?)?.cast<String, dynamic>();
      notifyListeners();
    } catch (err) {
      fail(err);
    }
  }

  void pickRepo(String? name) {
    repoFilter = repoFilter == name ? null : name;
    notifyListeners();
  }

  void pickWorkspace(String? root) {
    repoFilter = null;
    workspace = root;
    notifyListeners();
  }

  /// Which root a task belongs to. Its repo paths say so directly; a task
  /// from before those were stored falls back to the repo list by name.
  String? rootOf(Task task) {
    for (final path in (task.raw['repoPaths'] as List?)?.cast<String>() ?? const []) {
      for (final root in roots) {
        if (path == root || path.startsWith('$root/') || path.startsWith('$root\\')) return root;
      }
    }
    for (final name in task.repos) {
      for (final repo in repos) {
        if (repo['name'] == name) return repo['root'] as String?;
      }
    }
    return null;
  }

  /// The board, filtered to the chosen workspace.
  List<Task> get visible {
    final all = tasks ?? const <Task>[];
    if (workspace == null) return all;
    return all.where((t) => rootOf(t) == workspace).toList();
  }

  Future<void> loadDisk() async {
    try {
      final found = await api.disk();
      if (_gone) return;
      disk = found;
      notifyListeners();
    } catch (_) {
      // A number on a footer is not worth a banner.
    }
  }

  Future<void> select(String? id) async {
    selected = id;
    if (id == null) {
      detail = null;
      notifyListeners();
      return;
    }
    notifyListeners();
    await loadDetail(id);
  }

  Future<void> loadDetail(String id) async {
    try {
      final task = await api.task(id);
      if (selected != id) return;
      detail = task;
      notifyListeners();
    } catch (err) {
      fail(err);
    }
  }

  /// The stream drops when the server restarts, and everything that happened
  /// in between is missed. Reloading on every open is what keeps a question
  /// nobody is waiting on any more from staying on screen.
  /// Set once the app has somewhere to put a notification of its own.
  void Function(Map<String, dynamic> event)? onNotify;

  void listen() {
    _events?.cancel();
    _events = api.events(notifies: onNotify != null).listen(
      (message) {
        if (!live) {
          live = true;
          loadState();
          if (selected != null) loadDetail(selected!);
        }
        switch (message.event) {
          case 'task':
            _onTask(message.data);
          case 'log':
            _onLog(message.data);
          case 'notify':
            onNotify?.call(message.data);
        }
      },
      onError: (_) => _dropped(),
      onDone: _dropped,
      cancelOnError: true,
    );
  }

  void _dropped() {
    live = false;
    notifyListeners();
    _retry?.cancel();
    _retry = Timer(const Duration(seconds: 2), listen);
  }

  void _onTask(Map<String, dynamic> data) {
    final id = data['id'] as String?;
    if (id == null) return;

    if (data['removed'] == true) {
      tasks = tasks?.where((t) => t.id != id).toList();
      if (selected == id) {
        detail = null;
        selected = null;
      }
      notifyListeners();
      return;
    }

    final task = Task(data);
    final list = tasks ?? [];
    tasks = [task, ...list.where((t) => t.id != id)]
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    if (selected == id && detail != null) {
      // The event carries the task, not its log or documents: merge rather
      // than replace, or the conversation blanks on every tick.
      detail = Task({...detail!.raw, ...data});
    }
    notifyListeners();
  }

  void _onLog(Map<String, dynamic> data) {
    if (data['id'] != selected || detail == null) return;
    final entry = (data['entry'] as Map).cast<String, dynamic>();
    detail = Task({
      ...detail!.raw,
      'log': [...detail!.log, entry],
    });
    notifyListeners();
  }

  /// Wraps a call so every button reports the same way and refreshes after.
  Future<bool> run(Future<dynamic> Function() action, {bool refresh = true}) async {
    try {
      await action();
      if (refresh && selected != null) await loadDetail(selected!);
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  }

  @override
  void dispose() {
    _gone = true;
    _events?.cancel();
    _errorTimer?.cancel();
    _retry?.cancel();
    api.close();
    super.dispose();
  }
}
