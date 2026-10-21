import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// The server's shapes change with the server, and mirroring them in Dart
/// classes would mean editing two files every time one field moves. These are
/// thin readers over the JSON instead: typed where it matters, absent where
/// the server has not sent anything.
class Task {
  Task(this.raw);
  final Map<String, dynamic> raw;

  String get id => raw['id'] as String;
  String get title => (raw['title'] ?? raw['id']) as String;
  String get prompt => (raw['prompt'] ?? '') as String;
  String get status => (raw['status'] ?? '') as String;
  String? get phase => raw['phase'] as String?;
  String? get awaitingPhase => raw['awaitingPhase'] as String?;
  String? get error => raw['error'] as String?;
  String? get root => raw['root'] as String?;
  String? get model => raw['model'] as String?;
  String? get openQuestionId => raw['openQuestionId'] as String?;
  num get cost => (raw['cost'] ?? 0) as num;
  int get createdAt => (raw['createdAt'] ?? 0) as int;
  List<String> get repos => (raw['repos'] as List?)?.cast<String>() ?? const [];
  List<Map<String, dynamic>> get trees =>
      (raw['trees'] as List?)?.cast<Map<String, dynamic>>() ?? const [];
  List<Map<String, dynamic>> get questions =>
      (raw['questions'] as List?)?.cast<Map<String, dynamic>>() ?? const [];
  List<Map<String, dynamic>> get log =>
      (raw['log'] as List?)?.cast<Map<String, dynamic>>() ?? const [];
  Map<String, dynamic> get docs =>
      (raw['docs'] as Map?)?.cast<String, dynamic>() ?? const {};
  Map<String, dynamic> get phases =>
      (raw['phases'] as Map?)?.cast<String, dynamic>() ?? const {};
  List<String> get attachments =>
      ((raw['attachments'] ?? raw['images']) as List?)?.cast<String>() ?? const [];

  bool get running => status == 'running' || status == 'queued';
  bool get waiting => status == 'awaiting_approval' || status == 'awaiting_answer';
  bool get active => running || waiting;

  /// The live one, the way the server names it: a question left behind by a
  /// run that died keeps answer == null for ever.
  Map<String, dynamic>? get openQuestion {
    final open = questions.where((q) => q['answer'] == null).toList();
    if (open.isEmpty) return null;
    final named = openQuestionId;
    if (named != null) {
      for (final q in open) {
        if (q['id'] == named) return q;
      }
    }
    return open.last;
  }
}

class ApiError implements Exception {
  ApiError(this.message);
  final String message;
  @override
  String toString() => message;
}

class Api {
  Api(this.port);
  final int port;
  final _client = HttpClient();

  Uri _url(String path) => Uri.parse('http://127.0.0.1:$port$path');

  Future<dynamic> _send(String method, String path, [Object? payload]) async {
    final request = await _client.openUrl(method, _url(path));
    if (payload != null) {
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode(payload));
    }
    final response = await request.close();
    final text = await response.transform(utf8.decoder).join();
    final data = text.isEmpty ? null : jsonDecode(text);
    if (response.statusCode >= 400) {
      throw ApiError(
        (data is Map && data['error'] != null)
            ? data['error'] as String
            : 'HTTP ${response.statusCode}',
      );
    }
    return data;
  }

  Future<Map<String, dynamic>> state() async =>
      (await _send('GET', '/api/state')) as Map<String, dynamic>;

  Future<Task> task(String id) async =>
      Task((await _send('GET', '/api/tasks/$id')) as Map<String, dynamic>);

  /// One entry per repo: the server answers with a list, not an envelope.
  Future<List<Map<String, dynamic>>> diff(String id) async =>
      ((await _send('GET', '/api/tasks/$id/diff')) as List)
          .map((r) => (r as Map).cast<String, dynamic>())
          .toList();

  Future<List<Map<String, dynamic>>> gitState(String id) async =>
      ((await _send('GET', '/api/tasks/$id/git')) as List)
          .map((r) => (r as Map).cast<String, dynamic>())
          .toList();

  /// Tracked files in the given repos, for naming one in a prompt.
  Future<List<Map<String, dynamic>>> files(List<String> repos, String query) async {
    final params = [
      for (final repo in repos) 'repo=${Uri.encodeQueryComponent(repo)}',
      'q=${Uri.encodeQueryComponent(query)}',
    ].join('&');
    return ((await _send('GET', '/api/files?$params')) as List)
        .map((r) => (r as Map).cast<String, dynamic>())
        .toList();
  }

  Future<Map<String, dynamic>> disk() async =>
      (await _send('GET', '/api/disk')) as Map<String, dynamic>;

  Future<dynamic> prune() => _send('POST', '/api/disk/prune');

  Future<Map<String, dynamic>> shopify(String repo) async =>
      (await _send('GET', '/api/shopify?repo=${Uri.encodeComponent(repo)}'))
          as Map<String, dynamic>;

  Future<Map<String, dynamic>> openBrowser() async =>
      (await _send('POST', '/api/browser')) as Map<String, dynamic>;

  Future<dynamic> addRoot(String path) => _send('POST', '/api/roots', {'path': path});
  Future<dynamic> removeRoot(String path) =>
      _send('DELETE', '/api/roots', {'path': path});

  Future<Task> create(Map<String, dynamic> payload) async =>
      Task((await _send('POST', '/api/tasks', payload)) as Map<String, dynamic>);

  Future<dynamic> approve(String id, bool approved, String? feedback) =>
      _send('POST', '/api/tasks/$id/approve',
          {'approved': approved, 'feedback': feedback});

  Future<dynamic> answer(String id, String questionId, String answer) =>
      _send('POST', '/api/tasks/$id/answer',
          {'questionId': questionId, 'answer': answer});

  Future<dynamic> cancel(String id) => _send('POST', '/api/tasks/$id/cancel');
  Future<dynamic> retry(String id) => _send('POST', '/api/tasks/$id/retry');
  Future<dynamic> followUp(String id, String request) =>
      _send('POST', '/api/tasks/$id/follow-up', {'request': request});
  Future<dynamic> catchUp(String id, String repo) =>
      _send('POST', '/api/tasks/$id/catch-up', {'repo': repo});
  Future<dynamic> push(String id, String repo, {bool base = false}) =>
      _send('POST', '/api/tasks/$id/push', {'repo': repo, 'base': base});
  Future<dynamic> merge(String id, String repo) =>
      _send('POST', '/api/tasks/$id/merge', {'repo': repo});
  Future<dynamic> preview(String id, String path) =>
      _send('POST', '/api/tasks/$id/preview', {'path': path});
  Future<dynamic> dropWorktree(String id) =>
      _send('DELETE', '/api/tasks/$id/worktree');
  Future<dynamic> removeTask(String id) => _send('DELETE', '/api/tasks/$id');

  /// Uploads are raw bytes with the name in a header, the way the web client
  /// sends a pasted screenshot.
  Future<Map<String, dynamic>> upload(String name, List<int> bytes) async {
    final request = await _client.postUrl(_url('/api/uploads'));
    request.headers.set('X-Filename', name);
    request.add(bytes);
    final response = await request.close();
    final data = jsonDecode(await response.transform(utf8.decoder).join());
    if (response.statusCode >= 400) {
      throw ApiError((data['error'] ?? 'upload failed') as String);
    }
    return data as Map<String, dynamic>;
  }

  /// `notify` says whether this client will raise a desktop notification
  /// itself. When it will not, the server has to, or they disappear.
  Stream<({String event, Map<String, dynamic> data})> events({bool notifies = false}) async* {
    final request = await _client.getUrl(_url('/api/events?notify=${notifies ? 1 : 0}'));
    final response = await request.close();
    var name = 'message';
    await for (final line
        in response.transform(utf8.decoder).transform(const LineSplitter())) {
      if (line.startsWith('event: ')) {
        name = line.substring(7).trim();
      } else if (line.startsWith('data: ')) {
        final body = line.substring(6);
        if (body.isEmpty) continue;
        yield (event: name, data: jsonDecode(body) as Map<String, dynamic>);
      }
    }
  }

  void close() => _client.close(force: true);
}
