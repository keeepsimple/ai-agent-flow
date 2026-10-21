import 'api.dart';

/// What became of the branch, read from the outcome lines the server writes
/// once it has checked: "Landed on X" when the target really has the branch,
/// "Shipped to Y" when nothing is left to pick. Intentions ("then land on")
/// and stops are not fates; a later failure does not undo one.
String? fateOf(Task task) {
  String? fate;
  for (final e in task.log) {
    if (e['kind'] != 'decision') continue;
    final text = (e['text'] ?? '') as String;
    final land = RegExp(r'^Landed on (\S+)$').firstMatch(text);
    if (land != null) fate = 'landed on ${land.group(1)}';
    final ship = RegExp(r'^Shipped to (\S+)$').firstMatch(text);
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
