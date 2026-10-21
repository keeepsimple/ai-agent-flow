import 'api.dart';

/// What became of the branch, read from the decisions the runs wrote: the
/// last landing or shipping that was asked for on a task that ended well.
String? fateOf(Task task) {
  if (task.status != 'done') return null;
  String? fate;
  for (final e in task.log) {
    if (e['kind'] != 'decision') continue;
    final text = (e['text'] ?? '') as String;
    final land = RegExp(r'then land on (\S+)$').firstMatch(text);
    if (land != null) fate = 'landed on ${land.group(1)}';
    final ship = RegExp(r'^Ship to (\S+):').firstMatch(text);
    if (ship != null) fate = 'shipped to ${ship.group(1)}';
  }
  return fate;
}

String elapsedWords(int ms) {
  final minutes = ms ~/ 60000;
  if (minutes < 1) return '<1m';
  if (minutes < 60) return '${minutes}m';
  return '${minutes ~/ 60}h ${minutes % 60}m';
}
