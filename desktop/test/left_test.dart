import 'package:agent_flow/left.dart';
import 'package:flutter_test/flutter_test.dart';

const review = '''
# Review

## 1. Correctness
Fine.

## Left
- [ ] fixable: `useGetLatestSubmission` returns null on error and while loading (hooks/useGetLatestSubmission.ts:12)
- [x] fixable: duplicated toast block in schedule-content.tsx
- [ ] decision: the API accepts a schedule without a submission; the UI blocks it. Which is right?
- [ ] the nested en.json label is wrong but not this ticket's

## Verification
tsc exit 0
''';

void main() {
  test('the Left section is parsed into tagged items', () {
    final items = leftOf(review);
    expect(items.map((i) => i.kind).toList(), ['fixable', 'fixable', 'decision', 'decision']);
    expect(items.map((i) => i.done).toList(), [false, true, false, false]);
    expect(items[0].text, startsWith('`useGetLatestSubmission` returns null'));
    expect(items[3].text, 'the nested en.json label is wrong but not this ticket\'s');
    expect(items.where((i) => i.kind == 'fixable' && !i.done).length, 1);
  });

  test('no Left section, or no review, means nothing left', () {
    expect(leftOf('# Review\n\n## 1. Correctness\nok\n'), isEmpty);
    expect(leftOf(null), isEmpty);
  });
}
