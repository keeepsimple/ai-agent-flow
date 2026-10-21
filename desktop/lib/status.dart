import 'api.dart';
import 'widgets/bits.dart' show phaseLabels;

/// The two things worth reading instead of scrolling: what the agent last did,
/// and what it needs from you. Pure, so they can be tested without widgets.

const _cap = 140;

/// The first sentence of the last thing the agent said, or, while it is
/// running, the tool it is on when that came after its last message.
String? didOf(Task task) {
  final log = task.log;
  for (var i = log.length - 1; i >= 0; i--) {
    final entry = log[i];
    final kind = entry['kind'];
    if (kind == 'text') return _firstSentence((entry['text'] ?? '') as String);
    if (kind == 'tool' && task.running) {
      return '${entry['tool'] ?? ''}  ${entry['text'] ?? ''}'.trim();
    }
  }
  return null;
}

/// The open question, the gate it is waiting at, or nothing.
String? needsOf(Task task) {
  final question = task.openQuestion;
  if (question != null && task.status == 'awaiting_answer') {
    return _firstSentence((question['text'] ?? '') as String);
  }
  if (task.status == 'awaiting_approval') {
    final phase = task.awaitingPhase;
    return 'Your call: ${phaseLabels[phase] ?? phase ?? ''}';
  }
  if (task.interrupted) return 'Continue, or retry';
  return null;
}

String? _firstSentence(String text) {
  final flat = text
      .replaceAll(RegExp(r'^[#>*\-\s]+', multiLine: true), '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  if (flat.isEmpty) return null;
  final m = RegExp(r'^.*?[.!?](?=\s|$)').firstMatch(flat);
  var first = (m?.group(0) ?? flat).trim();
  if (first.length > _cap) first = '${first.substring(0, _cap)}…';
  return first;
}
