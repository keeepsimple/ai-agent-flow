// Renders each screen against stub data and writes it out as a picture.
//
// Two jobs: it is the only way to look at this UI without a person at the
// machine, and it fails when a layout overflows or throws, which is the class
// of bug a desktop window hides until someone resizes it.
//
//   flutter test --update-goldens     # write the pictures
//   flutter test                      # check nothing moved
import 'dart:io';

import 'package:agent_flow/api.dart';
import 'package:agent_flow/flow.dart';
import 'package:agent_flow/screens/review.dart';
import 'package:agent_flow/screens/sessions.dart';
import 'package:agent_flow/screens/workspace.dart';
import 'package:agent_flow/theme.dart';
import 'package:agent_flow/widgets/bits.dart';
import 'package:agent_flow/widgets/header.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// `flutter test` loads no fonts at all, so without this every glyph in the
/// pictures is a box, including the icons.
Future<void> loadFonts() async {
  // The runner is flutter_tester, buried somewhere under the SDK's cache, and
  // how deep depends on the platform. Walk up for it instead of counting.
  File? icons;
  var dir = Directory(Platform.resolvedExecutable).parent;
  for (var i = 0; i < 8; i++) {
    final guess = File('${dir.path}/material_fonts/MaterialIcons-Regular.otf');
    if (guess.existsSync()) {
      icons = guess;
      break;
    }
    if (dir.parent.path == dir.path) break;
    dir = dir.parent;
  }
  for (final entry in {
    'Geist': ['fonts/Geist-Regular.ttf', 'fonts/Geist-Medium.ttf', 'fonts/Geist-SemiBold.ttf'],
    'GeistMono': ['fonts/GeistMono-Regular.ttf'],
    if (icons != null) 'MaterialIcons': [icons.path],
  }.entries) {
    final loader = FontLoader(entry.key);
    for (final path in entry.value) {
      loader.addFont(File(path).readAsBytes().then((b) => ByteData.view(b.buffer)));
    }
    await loader.load();
  }
}

Task _task(Map<String, dynamic> extra) => Task({
      'id': 'a1b2c3d4',
      'title': 'get-discounts should return targeted product names',
      'prompt': 'get-discounts should return the targeted product and collection names, capped at 5',
      'status': 'running',
      'phase': 'implement',
      'repos': ['mobile-admin-shopify', 'notify-service'],
      'model': 'opus',
      'cost': 1.42,
      'createdAt': 1,
      'trees': [
        {'repo': 'mobile-admin-shopify', 'branch': 'flow/discount-names-a1b2c3d4'},
        {'repo': 'notify-service', 'branch': 'flow/discount-names-a1b2c3d4'},
      ],
      'phases': {
        'spec': {'status': 'done'},
        'plan': {'status': 'done'},
        'implement': {'status': 'running'},
      },
      'docs': {'spec.md': '# Spec', 'plan.md': '# Plan'},
      ...extra,
    });

FlowState _flow() {
  final flow = FlowState(Api(0));
  // The error banner dismisses itself after five seconds, and that timer
  // outlives the test unless the store is disposed with it.
  addTearDown(flow.dispose);
  flow.repos = [
    {'name': 'mobile-admin-shopify', 'path': '/w/mobile-admin-shopify'},
    {'name': 'notify-service', 'path': '/w/notify-service'},
    {'name': 'mobile-builder', 'path': '/w/mobile-builder'},
  ];
  flow.options = {
    'models': ['', 'fable', 'opus', 'sonnet', 'haiku'],
    'efforts': ['', 'low', 'medium', 'high', 'xhigh', 'max'],
    'modes': [
      {'value': 'bypassPermissions', 'label': 'Full access', 'hint': 'Runs anything.'},
      {'value': 'acceptEdits', 'label': 'Edits only', 'hint': 'No shell.'},
    ],
    'runs': [
      {'value': 'full', 'label': 'Spec, plan, then build', 'hint': 'Stops for you twice.'},
      {'value': 'quick', 'label': 'Just build it', 'hint': 'Straight to the work.'},
    ],
  };
  flow.defaults = {'model': '', 'effort': '', 'permissionMode': 'bypassPermissions'};
  flow.live = true;
  return flow;
}

Future<void> _shoot(WidgetTester tester, String name, Widget child, Size size) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: ternTheme(Accent.sky),
    home: Scaffold(backgroundColor: Tern.page, body: child),
  ));
  await tester.pump(const Duration(milliseconds: 60));
  await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/$name.png'));
  // The error banner dismisses itself after five seconds. Let that happen
  // rather than leaving the test holding a live timer.
  await tester.pump(const Duration(seconds: 6));
}

void main() {
  setUpAll(loadFonts);

  testWidgets('the board, with a task on it', (tester) async {
    final flow = _flow();
    flow.tasks = [
      _task({}),
      _task({
        'id': 'b2',
        'title': 'Create with AI loses its segment on the create form',
        'status': 'awaiting_approval',
        'awaitingPhase': 'plan',
        'phase': null,
        'cost': 0.31,
      }),
      _task({'id': 'c3', 'title': 'Kiwi size chart polish', 'status': 'done', 'phase': null}),
      _task({'id': 'd4', 'title': 'Port the email cron', 'status': 'failed', 'phase': null}),
    ];
    await _shoot(tester, 'sessions',
        SessionsScreen(flow: flow, onOpen: (_) {}), const Size(1340, 900));
  });

  testWidgets('the workspace, mid-run', (tester) async {
    final flow = _flow();
    final task = _task({
      'log': [
        {'kind': 'text', 'text': 'Reading the discount service to see what it already returns.'},
        {'kind': 'tool', 'tool': 'Read', 'text': 'app/services/discount.server.ts'},
        {'kind': 'tool', 'tool': 'Grep', 'text': 'getDiscounts'},
        {'kind': 'tool', 'tool': 'Edit', 'text': 'app/services/discount.server.ts'},
        {
          'kind': 'text',
          'text': '## What I changed\n\n'
              'The names now come back with the discount, capped at **5** per target.\n\n'
              '- `appliesToType` was being defaulted by Prisma, so it lied to mobile\n'
              '- Bxgy is excluded outright\n\n'
              'See https://gitlab.example.com/x/-/merge_requests/307 for the MR.',
        },
        {'kind': 'question', 'text': 'Should a deleted collection keep its name, or drop out?'},
      ],
      'questions': [
        {'id': 'q1', 'text': 'Should a deleted collection keep its name, or drop out?', 'answer': null},
      ],
      'status': 'awaiting_answer',
      'openQuestionId': 'q1',
    });
    flow.tasks = [task];
    await _shoot(tester, 'workspace',
        WorkspaceScreen(flow: flow, task: task), const Size(1340, 900));
  });

  testWidgets('the review, with somewhere to push', (tester) async {
    final flow = _flow();
    final task = _task({
      'status': 'done',
      'phase': null,
      'docs': {
        'review.md': '# Self review\n\n'
            'Checked correctness, quality, performance and security.\n\n'
            '| Check | Result |\n|---|---|\n| typecheck | pass |\n| lint | pass |\n',
      },
    });
    await _shoot(tester, 'review', ReviewScreen(flow: flow, task: task), const Size(1340, 900));
  });

  testWidgets('a repo row, with somewhere to push', (tester) async {
    await _shoot(
      tester,
      'repo-card',
      Padding(
        padding: const EdgeInsets.all(16),
        child: RepoCard(
          repo: const {
            'repo': 'mobile-admin-shopify',
            'branch': 'flow/discount-names-a1b2c3d4',
            'base': 'main',
            'ahead': 3,
            'behind': 7,
            'unpushed': 3,
            'baseUnpushed': 0,
            'remote': 'origin',
            'reviewUrl': 'https://gitlab.example.com/x/-/merge_requests/new',
            'pipeline': {'status': 'success', 'url': 'https://gitlab.example.com/p/1'},
            'mergeBlockedBy': null,
          },
          busy: '',
          onPush: () {},
          onPushBase: () {},
          onMerge: () {},
          onCatchUp: () {},
        ),
      ),
      const Size(430, 230),
    );
  });

  testWidgets('the header with nothing open', (tester) async {
    final flow = _flow();
    await _shoot(
      tester,
      'header-idle',
      Header(
        flow: flow,
        task: null,
        tab: 'workspace',
        onTab: (_) {},
        onBack: () {},
        accent: Accent.sky,
        onAccent: (_) {},
        onDropped: () {},
        onDeleted: () {},
      ),
      const Size(1340, 110),
    );
  });

  testWidgets('the bar lines up with the traffic lights', (tester) async {
    // Not eyeballed: AppKit reports the lights at x 9..69 with their centres
    // 16 from the top of the window. Centring the row in the bar instead put
    // everything 8pt low, which is what was visible.
    final flow = _flow();
    tester.view.physicalSize = const Size(1340, 110);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(MaterialApp(
      theme: ternTheme(Accent.sky),
      home: Scaffold(
        backgroundColor: Tern.page,
        body: Header(
          flow: flow,
          task: null,
          tab: 'workspace',
          onTab: (_) {},
          onBack: () {},
          accent: Accent.sky,
          onAccent: (_) {},
          onDropped: () {},
          onDeleted: () {},
        ),
      ),
    ));

    final mark = find.byType(Mark);
    expect(tester.getCenter(mark).dy, closeTo(16, 1.5),
        reason: 'level with the middle of the traffic lights');
    expect(tester.getTopLeft(mark).dx, closeTo(80, 0.5),
        reason: 'clear of the lights, which end at 69');
    expect(tester.getTopLeft(mark).dy, greaterThan(4),
        reason: 'and not running off the top of the window');
  });

  testWidgets('the header carries what the screen can do', (tester) async {
    final flow = _flow();
    final task = _task({'status': 'done', 'phase': null, 'root': '/w/tree'});
    await _shoot(
      tester,
      'header',
      Header(
        flow: flow,
        task: task,
        tab: 'workspace',
        onTab: (_) {},
        onBack: () {},
        accent: Accent.sky,
        onAccent: (_) {},
        onDropped: () {},
        onDeleted: () {},
      ),
      const Size(1340, 120),
    );
  });
}
