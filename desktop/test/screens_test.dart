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
import 'package:agent_flow/shortcuts.dart';
import 'package:agent_flow/screens/sessions.dart';
import 'package:agent_flow/prefs.dart';
import 'package:agent_flow/screens/workspace.dart';
import 'package:agent_flow/theme.dart';
import 'package:agent_flow/widgets/bits.dart';
import 'package:agent_flow/widgets/composer.dart';
import 'package:agent_flow/widgets/header.dart';
import 'package:agent_flow/widgets/sidebar.dart';
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
      'repoPaths': ['/w/mobile-builder/mobile-admin-shopify', '/w/mobile-builder/notify-service'],
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
  flow.roots = ['/w/mobile-builder', '/w/logistek'];
  flow.repos = [
    {'name': 'mobile-admin-shopify', 'path': '/w/mobile-builder/mobile-admin-shopify', 'root': '/w/mobile-builder'},
    {'name': 'notify-service', 'path': '/w/mobile-builder/notify-service', 'root': '/w/mobile-builder'},
    {'name': 'mobile-builder', 'path': '/w/mobile-builder/mobile-builder', 'root': '/w/mobile-builder'},
    {'name': 'warehouse-api', 'path': '/w/logistek/warehouse-api', 'root': '/w/logistek'},
  ];
  flow.options = {
    'models': ['', 'fable', 'opus', 'sonnet', 'haiku'],
    'efforts': ['', 'low', 'medium', 'high', 'xhigh', 'max'],
    'modes': [
      {'value': 'bypassPermissions', 'label': 'Full access', 'hint': 'Runs anything.'},
      {'value': 'acceptEdits', 'label': 'Edits only', 'hint': 'No shell.'},
    ],
    'runs': [
      {'value': 'ask', 'label': 'Normal', 'hint': 'One run, no documents and no self review.'},
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
      _task({
        'id': 'e5',
        'title': 'Driver app loses its route on a cold start',
        'status': 'running',
        'repos': ['warehouse-api'],
        'repoPaths': ['/w/logistek/warehouse-api'],
      }),
    ];
    await _shoot(tester, 'sessions',
        SessionsScreen(flow: flow, onOpen: (_) {}), const Size(1340, 900));
  });

  testWidgets('the workspaces, and what has been going on in them', (tester) async {
    final flow = _flow();
    flow.tasks = [
      _task({}),
      _task({'id': 'b2', 'title': 'Create with AI loses its segment', 'status': 'awaiting_approval', 'awaitingPhase': 'plan'}),
      _task({'id': 'c3', 'title': 'Kiwi size chart polish', 'status': 'done'}),
      _task({
        'id': 'e5',
        'title': 'Driver app loses its route on a cold start',
        'repos': ['warehouse-api'],
        'repoPaths': ['/w/logistek/warehouse-api'],
      }),
    ];
    await _shoot(tester, 'sidebar', Sidebar(flow: flow, onOpen: (_) {}),
        const Size(244, 460));
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
        WorkspaceScreen(flow: flow, task: task, prefs: Prefs.memory()), const Size(1340, 900));
  });

  testWidgets('a task on a whole workspace still has a send button', (tester) async {
    // Twelve repos laid out plainly ran off the end of the row and pushed the
    // buttons out of the window with them.
    final flow = _flow();
    final task = _task({
      'status': 'done',
      'phase': null,
      'root': '/w/tree',
      'trees': [
        for (final name in [
          'auth-server', 'cdn-service', 'chat-management', 'management-service',
          'mobile-pharmacy', 'notification-socket', 'order-service', 'payment-service',
          'report-service', 'search-service', 'stock-service', 'user-service',
        ])
          {'repo': name, 'branch': 'flow/x'},
      ],
    });

    await _shoot(tester, 'composer-many-repos',
        Composer(task: task, flow: flow), const Size(760, 200));

    final send = tester.getRect(find.byIcon(Icons.arrow_upward));
    expect(send.right, lessThanOrEqualTo(760),
        reason: 'the send button has to stay inside the window');
    expect(find.textContaining('more'), findsOneWidget,
        reason: 'and the repos that did not fit are counted, not dropped silently');
  });

  testWidgets('the diff pane can be put away', (tester) async {
    final flow = _flow();
    final task = _task({});
    final prefs = Prefs.memory()..set(changesWidth: 400);

    Future<double> paneWidth() async {
      await tester.pumpWidget(MaterialApp(
        theme: ternTheme(Accent.sky),
        home: Scaffold(
          backgroundColor: Tern.page,
          body: WorkspaceScreen(flow: flow, task: task, prefs: prefs),
        ),
      ));
      await tester.pump(const Duration(milliseconds: 60));
      return tester.getSize(find.byKey(const ValueKey('changes-pane'))).width;
    }

    tester.view.physicalSize = const Size(1340, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    expect(await paneWidth(), 400, reason: 'open, it is the width that was remembered');

    prefs.set(changesOpen: false);
    final shut = await paneWidth();
    expect(shut, lessThan(60), reason: 'shut, it is a strip with the button on it');
    expect(find.text('Nothing changed yet.'), findsNothing,
        reason: 'and the diff is not being laid out behind it');
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
        sidebarOpen: true,
        fullScreen: false,
        onToggleSidebar: () {},
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

  test('a task belongs to the workspace its repos live in', () {
    final flow = _flow(); // already disposes itself at the end of the test
    flow.tasks = [
      _task({}),
      _task({
        'id': 'e5',
        'repos': ['warehouse-api'],
        'repoPaths': ['/w/logistek/warehouse-api'],
      }),
      // No repoPaths: an older task, matched through the repo list by name.
      _task({'id': 'old', 'repos': ['warehouse-api'], 'repoPaths': null}),
    ];

    expect(flow.rootOf(flow.tasks![0]), '/w/mobile-builder');
    expect(flow.rootOf(flow.tasks![1]), '/w/logistek');
    expect(flow.rootOf(flow.tasks![2]), '/w/logistek',
        reason: 'a task stored before repo paths were still has repo names');

    flow.pickWorkspace('/w/logistek');
    expect(flow.visible.map((t) => t.id), ['e5', 'old']);
    flow.pickWorkspace(null);
    expect(flow.visible, hasLength(3), reason: 'no workspace means all of them');
  });

  testWidgets('the shortcuts fire even while a field has focus', (tester) async {
    // The bug this is about was not the bindings: a shortcut is only seen on
    // its way up from whatever has focus, so with nothing focused inside the
    // subtree holding them, Cmd-\\ reached nothing at all.
    var sidebar = 0;
    final picked = <int>[];
    var everything = 0;

    await tester.pumpWidget(MaterialApp(
      home: CallbackShortcuts(
        bindings: workspaceShortcuts(
          workspaces: 2,
          onWorkspace: picked.add,
          onEverything: () => everything++,
          onToggleSidebar: () => sidebar++,
        ),
        child: const Focus(
          autofocus: true,
          child: Material(child: TextField(autofocus: true)),
        ),
      ),
    ));
    await tester.pump();

    Future<void> press(LogicalKeyboardKey key) async {
      await tester.sendKeyDownEvent(LogicalKeyboardKey.meta);
      await tester.sendKeyEvent(key);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.meta);
      await tester.pump();
    }

    await press(LogicalKeyboardKey.backslash);
    expect(sidebar, 1, reason: 'Cmd-\\ has to reach the window, not the text field');

    await press(LogicalKeyboardKey.digit2);
    expect(picked, [1]);

    await press(LogicalKeyboardKey.digit9);
    expect(picked, [1], reason: 'there is no ninth workspace to switch to');

    await press(LogicalKeyboardKey.digit0);
    expect(everything, 1);
  });

  testWidgets('the bar lines up with the traffic lights', (tester) async {
    // Not eyeballed: with a unified toolbar AppKit reports the lights at
    // x 19..79 with their centres 26 from the top of the window.
    final flow = _flow();
    tester.view.physicalSize = const Size(1340, 120);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(MaterialApp(
      theme: ternTheme(Accent.sky),
      home: Scaffold(
        backgroundColor: Tern.page,
        body: Header(
          flow: flow,
          sidebarOpen: true,
        fullScreen: false,
          onToggleSidebar: () {},
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

    expect(tester.getCenter(find.byType(Mark)).dy, closeTo(26, 1.5),
        reason: 'level with the middle of the traffic lights');

    // Whatever comes first in the bar is the thing that has to clear them.
    final leading = tester.getTopLeft(find.byIcon(Icons.menu_open)).dx;
    expect(leading, greaterThanOrEqualTo(79),
        reason: 'the lights end at 79 and nothing may sit on top of them');
    expect(leading, lessThan(120), reason: 'but not pushed halfway across either');
  });

  testWidgets('full screen stops leaving room for lights that are gone', (tester) async {
    final flow = _flow();
    tester.view.physicalSize = const Size(1340, 120);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(MaterialApp(
      theme: ternTheme(Accent.sky),
      home: Scaffold(
        backgroundColor: Tern.page,
        body: Header(
          flow: flow,
          sidebarOpen: true,
          onToggleSidebar: () {},
          fullScreen: true,
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

    expect(tester.getTopLeft(find.byIcon(Icons.menu_open)).dx, lessThan(40),
        reason: 'there are no traffic lights in full screen to clear');
  });

  testWidgets('the header carries what the screen can do', (tester) async {
    final flow = _flow();
    final task = _task({'status': 'done', 'phase': null, 'root': '/w/tree'});
    await _shoot(
      tester,
      'header',
      Header(
        flow: flow,
        sidebarOpen: true,
        fullScreen: false,
        onToggleSidebar: () {},
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
