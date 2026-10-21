import 'package:agent_flow/api.dart';
import 'package:agent_flow/fate.dart';
import 'package:flutter_test/flutter_test.dart';

Task task(String status, List<Map<String, dynamic>> log) =>
    Task({'id': 'x', 'title': 't', 'status': status, 'log': log, 'questions': const []});

void main() {
  test('what became of the branch is read from outcome lines, not intentions', () {
    expect(fateOf(task('done', [])), isNull);
    expect(fateOf(task('done', [
      {'kind': 'decision', 'text': 'Push flow/x, open a merge request, then land on main'},
    ])), isNull, reason: 'asking for a landing is not a landing');
    expect(fateOf(task('done', [
      {'kind': 'decision', 'text': 'Push flow/x, open a merge request, then land on main'},
      {'kind': 'decision', 'text': 'Landed on main'},
    ])), 'landed on main');
    expect(fateOf(task('done', [
      {'kind': 'decision', 'text': 'Landed on release'},
      {'kind': 'decision', 'text': 'Ship to prod: cherry-pick 2 commits of flow/x onto prod, push it'},
      {'kind': 'decision', 'text': 'Shipped to prod'},
    ])), 'shipped to prod');
    expect(fateOf(task('done', [
      {'kind': 'decision', 'text': 'Landed on main'},
      {'kind': 'decision', 'text': 'Landing on main stopped: 2 commits still not on main'},
    ])), 'landed on main', reason: 'an earlier landing stands; a later stop is not a fate');
    expect(fateOf(task('failed', [
      {'kind': 'decision', 'text': 'Landed on main'},
    ])), 'landed on main', reason: 'a later failure does not undo a landing that happened');
  });

  test('elapsed reads as minutes or hours', () {
    expect(elapsedWords(5 * 60 * 1000), '5m');
    expect(elapsedWords(125 * 60 * 1000), '2h 5m');
    expect(elapsedWords(20 * 1000), '<1m');
  });
}
