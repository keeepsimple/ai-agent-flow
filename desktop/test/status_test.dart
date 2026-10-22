import 'package:agent_flow/api.dart';
import 'package:agent_flow/status.dart';
import 'package:flutter_test/flutter_test.dart';

Task task(Map<String, dynamic> extra) => Task({
      'id': 'x',
      'title': 't',
      'status': 'done',
      'phase': null,
      'questions': const [],
      'log': const [],
      ...extra,
    });

void main() {
  test('did is the first sentence of the last thing the agent said', () {
    final t = task({
      'log': [
        {'kind': 'text', 'text': 'Looked at the code. Nothing there.'},
        {'kind': 'tool', 'tool': 'Bash', 'text': 'npm test'},
        {'kind': 'text', 'text': 'Fixed the parser so empty rows are skipped! Then ran the tests, which pass.'},
      ],
    });
    expect(didOf(t), 'Fixed the parser so empty rows are skipped!');
  });

  test('while running, a tool after the last message is what it is doing now', () {
    final t = task({
      'status': 'running',
      'log': [
        {'kind': 'text', 'text': 'Reading first.'},
        {'kind': 'tool', 'tool': 'Read', 'text': 'server/runner.js'},
      ],
    });
    expect(didOf(t), 'Read  server/runner.js');
  });

  test('a finished task ignores tools after its last message', () {
    final t = task({
      'log': [
        {'kind': 'text', 'text': 'All done.'},
        {'kind': 'tool', 'tool': 'Bash', 'text': 'git status'},
      ],
    });
    expect(didOf(t), 'All done.');
  });

  test('did is capped and stripped of markdown furniture', () {
    final long = '## ${'word ' * 60}';
    final t = task({'log': [{'kind': 'text', 'text': long}]});
    expect(didOf(t)!.length, lessThanOrEqualTo(141));
    expect(didOf(t), startsWith('word word'));
    expect(didOf(t), endsWith('…'));
    expect(didOf(task({})), isNull);
  });

  test('needs is the open question, else the gate, else nothing', () {
    final asked = task({
      'status': 'awaiting_answer',
      'questions': [
        {'id': 'q1', 'text': 'Keep the old column?', 'answer': null},
      ],
    });
    expect(needsOf(asked), 'Keep the old column?');
    final gated = task({'status': 'awaiting_approval', 'awaitingPhase': 'plan'});
    expect(needsOf(gated), 'Your call: Plan');
    expect(needsOf(task({'status': 'running'})), isNull);
    expect(needsOf(task({'status': 'interrupted'})), 'Continue, or retry');
  });

  test('a lead counts its pieces, a piece names its lead', () {
    final lead = task({'id': 'l1', 'title': 'The admin page', 'pieces': ['p1', 'p2']});
    final one = task({'id': 'p1', 'lead': 'l1', 'status': 'done'});
    final two = task({'id': 'p2', 'lead': 'l1', 'status': 'running'});
    final all = [lead, one, two];
    expect(teamWords(lead, all), '  ·  1 of 2 pieces done');
    expect(teamWords(one, all), '  ·  a piece of The admin page');
    // A piece whose lead has been deleted still says what it is.
    expect(teamWords(two, [two]), '  ·  a piece');
    expect(teamWords(task({'id': 'x'}), all), '');
  });
}
