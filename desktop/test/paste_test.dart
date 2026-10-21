// Both prompt boxes paste through one function. This is the half that does
// not need a real clipboard with a real screenshot on it.
import 'package:agent_flow/api.dart';
import 'package:agent_flow/paste.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.getData') return {'text': 'pasted words'};
      return null;
    });
  });

  test('with no image on the clipboard, the text goes in at the cursor', () async {
    final controller = TextEditingController(text: 'before after');
    controller.selection = const TextSelection.collapsed(offset: 7);

    await pasteInto(
      controller: controller,
      api: Api(0),
      onAttached: (_) => fail('nothing was attached'),
      onError: (err) => fail('$err'),
      readImage: () async => null,
    );

    expect(controller.text, 'before pasted wordsafter');
    expect(controller.selection.baseOffset, 'before pasted words'.length);
  });

  test('an empty box takes the text at the end rather than throwing', () async {
    final controller = TextEditingController();

    await pasteInto(
      controller: controller,
      api: Api(0),
      onAttached: (_) => fail('nothing was attached'),
      onError: (err) => fail('$err'),
      readImage: () async => null,
    );

    expect(controller.text, 'pasted words');
  });
}
