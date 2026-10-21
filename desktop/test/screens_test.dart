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
import 'package:agent_flow/screens/prompts.dart';
import 'package:agent_flow/screens/sessions.dart';
import 'package:agent_flow/prefs.dart';
import 'package:agent_flow/server.dart';
import 'package:agent_flow/screens/workspace.dart';
import 'package:agent_flow/theme.dart';
import 'package:agent_flow/widgets/bits.dart';
import 'package:agent_flow/widgets/composer.dart';
import 'package:agent_flow/widgets/conversation.dart';
import 'package:agent_flow/widgets/mentions.dart';
import 'package:agent_flow/widgets/markdown_view.dart';
import 'package:agent_flow/widgets/header.dart';
import 'package:agent_flow/widgets/secrets.dart';
import 'package:agent_flow/widgets/sidebar.dart';
import 'package:agent_flow/widgets/status_line.dart';
import 'package:flutter/gestures.dart';
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
    'Geist': [
      'fonts/Geist-Regular.ttf',
      'fonts/Geist-Medium.ttf',
      'fonts/Geist-SemiBold.ttf',
    ],
    'GeistMono': ['fonts/GeistMono-Regular.ttf'],
    if (icons != null) 'MaterialIcons': [icons.path],
  }.entries) {
    final loader = FontLoader(entry.key);
    for (final path in entry.value) {
      loader.addFont(
        File(path).readAsBytes().then((b) => ByteData.view(b.buffer)),
      );
    }
    await loader.load();
  }
}

/// An API that records follow-ups instead of sending them.
class _CapturingApi extends Api {
  _CapturingApi() : super(0);
  final sent = <String>[];
  @override
  Future<dynamic> followUp(
    String id,
    String request, {
    bool hideSecrets = false,
  }) async {
    sent.add(request);
    return <String, dynamic>{};
  }
}

/// Always has something to offer, so the overlay is guaranteed to open.
class _FilesApi extends Api {
  _FilesApi() : super(0);
  @override
  Future<List<Map<String, dynamic>>> files(
    List<String> repos,
    String query,
  ) async => [
    {'repo': 'agent-flow', 'path': 'CLAUDE.md'},
    {'repo': 'agent-flow', 'path': 'README.md'},
  ];
}

Task _task(Map<String, dynamic> extra) => Task({
  'id': 'a1b2c3d4',
  'title': 'get-discounts should return targeted product names',
  'prompt': 'get-discounts should return the targeted product and collection names, capped at 5',
  'status': 'running',
  'phase': 'implement',
  'repos': ['mobile-admin-shopify', 'notify-service'],
  'repoPaths': [
    '/w/mobile-builder/mobile-admin-shopify',
    '/w/mobile-builder/notify-service',
  ],
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
    {
      'name': 'mobile-admin-shopify',
      'path': '/w/mobile-builder/mobile-admin-shopify',
      'root': '/w/mobile-builder',
    },
    {
      'name': 'notify-service',
      'path': '/w/mobile-builder/notify-service',
      'root': '/w/mobile-builder',
    },
    {
      'name': 'mobile-builder',
      'path': '/w/mobile-builder/mobile-builder',
      'root': '/w/mobile-builder',
    },
    {
      'name': 'warehouse-api',
      'path': '/w/logistek/warehouse-api',
      'root': '/w/logistek',
    },
  ];
  flow.options = {
    'models': ['', 'fable', 'opus', 'sonnet', 'haiku'],
    'efforts': ['', 'low', 'medium', 'high', 'xhigh', 'max'],
    'modes': [
      {
        'value': 'bypassPermissions',
        'label': 'Full access',
        'hint': 'Runs anything.',
      },
      {'value': 'acceptEdits', 'label': 'Edits only', 'hint': 'No shell.'},
    ],
    'runs': [
      {
        'value': 'ask',
        'label': 'Normal',
        'hint': 'One run, no documents and no self review.',
      },
      {
        'value': 'full',
        'label': 'Spec, plan, then build',
        'hint': 'Stops for you twice.',
      },
      {
        'value': 'quick',
        'label': 'Just build it',
        'hint': 'Straight to the work.',
      },
    ],
  };
  flow.defaults = {
    'model': '',
    'effort': '',
    'permissionMode': 'bypassPermissions',
  };
  flow.live = true;
  return flow;
}

Future<void> _shoot(
  WidgetTester tester,
  String name,
  Widget child,
  Size size,
) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ternTheme(Accent.sky),
      home: Scaffold(backgroundColor: Tern.page, body: child),
    ),
  );
  await tester.pump(const Duration(milliseconds: 60));
  await expectLater(
    find.byType(MaterialApp),
    matchesGoldenFile('goldens/$name.png'),
  );
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
      _task({
        'id': 'c3',
        'title': 'Kiwi size chart polish',
        'status': 'done',
        'phase': null,
      }),
      _task({
        'id': 'd4',
        'title': 'Port the email cron',
        'status': 'failed',
        'phase': null,
      }),
      _task({
        'id': 'e5',
        'title': 'Driver app loses its route on a cold start',
        'status': 'running',
        'repos': ['warehouse-api'],
        'repoPaths': ['/w/logistek/warehouse-api'],
      }),
    ];
    await _shoot(
      tester,
      'sessions',
      SessionsScreen(flow: flow, onOpen: (_) {}),
      const Size(1340, 900),
    );
  });

  testWidgets(
    'a finished task on the board can drop its worktree without opening it',
    (tester) async {
      final flow = _flow();
      var opened = 0;
      flow.tasks = [
        _task({
          'id': 'd1',
          'title': 'Done, checkout still there',
          'status': 'done',
          'phase': null,
          'root': '/w/tree',
        }),
        _task({
          'id': 'd2',
          'title': 'Done, already dropped',
          'status': 'done',
          'phase': null,
          'root': null,
        }),
        _task({
          'id': 'r1',
          'title': 'Still running',
          'status': 'running',
          'root': '/w/tree2',
        }),
      ];
      tester.view.physicalSize = const Size(1340, 700);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          theme: ternTheme(Accent.sky),
          home: Scaffold(
            body: SessionsScreen(flow: flow, onOpen: (_) => opened++),
          ),
        ),
      );
      await tester.pump();
      expect(
        find.byIcon(Icons.folder_off_outlined),
        findsOneWidget,
        reason: 'only the finished task with a checkout',
      );
      await tester.tap(find.byIcon(Icons.folder_off_outlined));
      await tester.pump();
      expect(opened, 0, reason: 'dropping is not opening');
      await tester.pump(const Duration(seconds: 6));
    },
  );

  testWidgets(
    'interrupted tasks sit at the top of the board with one Continue for the lot',
    (tester) async {
      final flow = _flow();
      flow.tasks = [
        _task({
          'id': 'i1',
          'title': 'Port the email cron',
          'status': 'interrupted',
          'phase': null,
        }),
        _task({
          'id': 'i2',
          'title': 'Kiwi size chart polish',
          'status': 'interrupted',
          'phase': null,
        }),
        _task({
          'id': 'c3',
          'title': 'Done thing',
          'status': 'done',
          'phase': null,
        }),
      ];
      await _shoot(
        tester,
        'sessions-interrupted',
        SessionsScreen(flow: flow, onOpen: (_) {}),
        const Size(1340, 700),
      );
      expect(find.text('2 interrupted'), findsOneWidget);
      expect(find.text('Continue all'), findsOneWidget);
    },
  );

  testWidgets('an interrupted task offers Continue in the header', (
    tester,
  ) async {
    final flow = _flow();
    final task = _task({
      'status': 'interrupted',
      'phase': null,
      'root': '/w/tree',
    });
    tester.view.physicalSize = const Size(1340, 120);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        theme: ternTheme(Accent.sky),
        home: Scaffold(
          body: Header(
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
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Continue'), findsOneWidget);
    expect(find.text('Retry'), findsNothing);
    await tester.pump(const Duration(seconds: 6));
  });

  test('continue-on-launch is a preference the server is told about', () {
    final prefs = Prefs.memory();
    expect(prefs.autoResume, isTrue);
    expect(
      FlowServer.environment(1, prefs).containsKey('FLOW_AUTO_RESUME'),
      isFalse,
    );
    prefs.set(autoResume: false);
    expect(prefs.autoResume, isFalse);
    expect(FlowServer.environment(1, prefs)['FLOW_AUTO_RESUME'], '0');
  });

  testWidgets('the form asks before a secret goes into the transcript', (
    tester,
  ) async {
    await _shoot(
      tester,
      'secrets-dialog',
      const Center(
        child: SecretsDialog(
          found: ['EGO_API_KEY', 'SECRET_1'],
          editsOnly: true,
        ),
      ),
      const Size(640, 360),
    );
    expect(find.text('Keep out of the transcript'), findsOneWidget);
    expect(find.text('EGO_API_KEY'), findsOneWidget);
    expect(find.textContaining('Edits only has no shell'), findsOneWidget);
  });

  testWidgets('the workspaces, and what has been going on in them', (
    tester,
  ) async {
    final flow = _flow();
    flow.tasks = [
      _task({}),
      _task({
        'id': 'b2',
        'title': 'Create with AI loses its segment',
        'status': 'awaiting_approval',
        'awaitingPhase': 'plan',
      }),
      _task({'id': 'c3', 'title': 'Kiwi size chart polish', 'status': 'done'}),
      _task({
        'id': 'e5',
        'title': 'Driver app loses its route on a cold start',
        'repos': ['warehouse-api'],
        'repoPaths': ['/w/logistek/warehouse-api'],
      }),
    ];
    flow.disk = {
      'total': 3.5 * 1024 * 1024 * 1024,
      'reclaimable': 2.2 * 1024 * 1024 * 1024,
    };
    final prefs = Prefs.memory();
    await _shoot(
      tester,
      'sidebar',
      Sidebar(flow: flow, onOpen: (_) {}, onPick: (_) {}, prefs: prefs),
      const Size(244, 460),
    );
    // Continue-on-launch lives in the footer, and flipping it is remembered.
    expect(find.text('Continue on launch'), findsOneWidget);
    await tester.tap(find.byType(Switch));
    await tester.pump();
    expect(prefs.autoResume, isFalse);
  });

  testWidgets('clicking a workspace says so, rather than filtering in place', (
    tester,
  ) async {
    // It used to call flow.pickWorkspace itself, which changed the board
    // without leaving the task that was covering it.
    final flow = _flow();
    flow.tasks = [_task({})];
    final picked = <Object?>[];

    tester.view.physicalSize = const Size(244, 520);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: ternTheme(Accent.sky),
        home: Scaffold(
          backgroundColor: Tern.page,
          body: Sidebar(flow: flow, onOpen: (_) {}, onPick: picked.add),
        ),
      ),
    );
    await tester.pump();

    await tester.tap(find.text('logistek'));
    await tester.tap(find.text('Everything'));
    await tester.pump();

    expect(picked, ['/w/logistek', null]);
    expect(
      flow.workspace,
      isNull,
      reason: 'the sidebar reports the choice; it does not apply it alone',
    );
  });

  testWidgets('the workspace, mid-run', (tester) async {
    final flow = _flow();
    final task = _task({
      'log': [
        {
          'kind': 'text',
          'text':
              'Reading the discount service to see what it already returns.',
        },
        {
          'kind': 'tool',
          'tool': 'Read',
          'text': 'app/services/discount.server.ts',
        },
        {'kind': 'tool', 'tool': 'Grep', 'text': 'getDiscounts'},
        {
          'kind': 'tool',
          'tool': 'Edit',
          'text': 'app/services/discount.server.ts',
        },
        {
          'kind': 'text',
          'text':
              '## What I changed\n\n'
              'The names now come back with the discount, capped at **5** per target.\n\n'
              '- `appliesToType` was being defaulted by Prisma, so it lied to mobile\n'
              '- Bxgy is excluded outright\n\n'
              'See https://gitlab.example.com/x/-/merge_requests/307 for the MR.',
        },
        {
          'kind': 'question',
          'text': 'Should a deleted collection keep its name, or drop out?',
        },
      ],
      'questions': [
        {
          'id': 'q1',
          'text': 'Should a deleted collection keep its name, or drop out?',
          'answer': null,
        },
      ],
      'status': 'awaiting_answer',
      'openQuestionId': 'q1',
    });
    flow.tasks = [task];
    await _shoot(
      tester,
      'workspace',
      WorkspaceScreen(flow: flow, task: task, prefs: Prefs.memory()),
      const Size(1340, 900),
    );
  });

  testWidgets('a task on a whole workspace still has a send button', (
    tester,
  ) async {
    // Twelve repos laid out plainly ran off the end of the row and pushed the
    // buttons out of the window with them.
    final flow = _flow();
    final task = _task({
      'status': 'done',
      'phase': null,
      'root': '/w/tree',
      'trees': [
        for (final name in [
          'auth-server',
          'cdn-service',
          'chat-management',
          'management-service',
          'mobile-pharmacy',
          'notification-socket',
          'order-service',
          'payment-service',
          'report-service',
          'search-service',
          'stock-service',
          'user-service',
        ])
          {'repo': name, 'branch': 'flow/x'},
      ],
    });

    await _shoot(
      tester,
      'composer-many-repos',
      Composer(task: task, flow: flow),
      const Size(760, 200),
    );

    final send = tester.getRect(find.byIcon(Icons.arrow_upward));
    expect(
      send.right,
      lessThanOrEqualTo(760),
      reason: 'the send button has to stay inside the window',
    );
    expect(
      find.textContaining('more'),
      findsOneWidget,
      reason:
          'and the repos that did not fit are counted, not dropped silently',
    );
  });

  testWidgets('the diff pane can be put away', (tester) async {
    final flow = _flow();
    final task = _task({});
    final prefs = Prefs.memory()..set(changesWidth: 400);

    Future<double> paneWidth() async {
      await tester.pumpWidget(
        MaterialApp(
          theme: ternTheme(Accent.sky),
          home: Scaffold(
            backgroundColor: Tern.page,
            body: WorkspaceScreen(flow: flow, task: task, prefs: prefs),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 60));
      return tester.getSize(find.byKey(const ValueKey('changes-pane'))).width;
    }

    tester.view.physicalSize = const Size(1340, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    expect(
      await paneWidth(),
      400,
      reason: 'open, it is the width that was remembered',
    );

    prefs.set(changesOpen: false);
    final shut = await paneWidth();
    expect(
      shut,
      lessThan(60),
      reason: 'shut, it is a strip with the button on it',
    );
    expect(
      find.text('Nothing changed yet.'),
      findsNothing,
      reason: 'and the diff is not being laid out behind it',
    );
  });

  testWidgets('the @ list opens away from the edge it would run off', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(900, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    Future<Rect> openAt(MainAxisAlignment where) async {
      final controller = TextEditingController();
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: ternTheme(Accent.sky),
          home: Scaffold(
            backgroundColor: Tern.page,
            body: Column(
              mainAxisAlignment: where,
              children: [
                Mentions(
                  key: ValueKey(where),
                  controller: controller,
                  repos: const ['agent-flow'],
                  api: _FilesApi(),
                  child: TextField(controller: controller),
                ),
              ],
            ),
          ),
        ),
      );
      controller.text = '@';
      controller.selection = const TextSelection.collapsed(offset: 1);
      // Past the 140ms debounce, then a frame for the lookup to land and one
      // more for the overlay it inserts.
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pump();
      await tester.pump();
      return tester.getRect(find.byType(ListView));
    }

    // The New task box sits at the top of the board. Opening upward there ran
    // the list off the top of the window, which is what this is about.
    var list = await openAt(MainAxisAlignment.start);
    var field = tester.getRect(find.byType(TextField));
    expect(
      list.top,
      greaterThanOrEqualTo(field.bottom),
      reason: 'with no room above, the list opens downward',
    );

    // The composer sits at the foot of a workspace, where the opposite holds.
    list = await openAt(MainAxisAlignment.end);
    field = tester.getRect(find.byType(TextField));
    expect(
      list.bottom,
      lessThanOrEqualTo(field.top),
      reason: 'with no room below, it still opens upward',
    );
  });

  testWidgets('a conversation opens at the top, with a way down', (
    tester,
  ) async {
    // The goldens cannot cover either half: the button lives at an opacity the
    // golden reads as absent, and where a list is scrolled to is not something
    // a still frame of the top of it can show.
    final task = _task({
      'log': [
        for (var i = 0; i < 80; i++) {'kind': 'text', 'text': 'Step $i'},
      ],
    });

    tester.view.physicalSize = const Size(800, 700);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: ternTheme(Accent.sky),
        home: Scaffold(
          backgroundColor: Tern.page,
          body: Conversation(task: task),
        ),
      ),
    );
    await tester.pump();

    double shown() => tester
        .widgetList<AnimatedOpacity>(
          find.ancestor(
            of: find.text('Latest'),
            matching: find.byType(AnimatedOpacity),
          ),
        )
        .first
        .opacity;

    // Where it is scrolled to, asked of the list rather than of the text: the
    // messages render through markdown, so there is no flat Text to look for.
    double offset() => tester
        .widget<ListView>(find.byType(ListView))
        .controller!
        .position
        .pixels;

    // It opens where the run starts, so the whole of it is below and the way
    // down is offered from the first frame.
    expect(offset(), 0, reason: 'a conversation opens where the run starts');
    expect(shown(), 1, reason: 'and the way down should be offered');

    await tester.tap(find.text('Latest'));
    // Frame by frame, not pumpAndSettle: the live status dot pulses for ever,
    // so nothing on this screen ever settles.
    for (var i = 0; i < 20; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    expect(shown(), 0, reason: 'and it should retire once it has done its job');
    expect(
      offset(),
      greaterThan(0),
      reason: 'because it actually took the reader to the end',
    );
  });

  testWidgets('a long conversation only builds what is on screen', (
    tester,
  ) async {
    // Real runs reach four hundred log lines. Building them all meant
    // re-parsing every message's markdown on every frame, and a running task
    // emits several lines a second.
    final flow = _flow();
    final task = _task({
      'log': [
        for (var i = 0; i < 300; i++)
          {
            'kind': 'text',
            'text': 'Step $i\n\nSome **markdown** with `code` in it.',
          },
      ],
    });

    tester.view.physicalSize = const Size(800, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: ternTheme(Accent.sky),
        home: Scaffold(
          backgroundColor: Tern.page,
          body: Conversation(task: task),
        ),
      ),
    );
    await tester.pump();

    final built = tester.widgetList(find.byType(MarkdownView)).length;
    expect(
      built,
      lessThan(40),
      reason: 'only the visible messages should be built, not all 300',
    );
    expect(built, greaterThan(0), reason: 'and the visible ones should be');
    expect(flow.error, isNull);
  });

  testWidgets('the review, with somewhere to push', (tester) async {
    final flow = _flow();
    final task = _task({
      'status': 'done',
      'phase': null,
      'docs': {
        'review.md':
            '# Self review\n\n'
            'Checked correctness, quality, performance and security.\n\n'
            '| Check | Result |\n|---|---|\n| typecheck | pass |\n| lint | pass |\n',
      },
    });
    await _shoot(
      tester,
      'review',
      ReviewScreen(flow: flow, task: task),
      const Size(1340, 900),
    );
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
            'pipeline': {
              'status': 'success',
              'url': 'https://gitlab.example.com/p/1',
            },
            'mergeBlockedBy': null,
            'targets': ['main', 'release', 'prod'],
            'landTarget': 'main',
          },
          busy: '',
          onPush: () {},
          onPushBase: () {},
          onMerge: (_) {},
          onCatchUp: () {},
          onShip: () {},
          onConfigureProd: () {},
        ),
      ),
      const Size(430, 230),
    );
  });

  testWidgets('Land can be pointed at another branch from the card', (
    tester,
  ) async {
    final landed = <String>[];
    tester.view.physicalSize = const Size(600, 400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        theme: ternTheme(Accent.sky),
        home: Scaffold(
          body: RepoCard(
            repo: const {
              'repo': 'web',
              'branch': 'flow/x-1',
              'base': 'main',
              'ahead': 2,
              'behind': 0,
              'unpushed': 0,
              'baseUnpushed': 0,
              'remote': 'origin',
              'targets': ['main', 'release'],
              'landTarget': 'release',
            },
            busy: '',
            onPush: () {},
            onPushBase: () {},
            onMerge: landed.add,
            onCatchUp: () {},
            onShip: () {},
            onConfigureProd: () {},
          ),
        ),
      ),
    );
    await tester.pump();
    expect(
      find.text('Land on main'),
      findsOneWidget,
      reason: 'the base stays the default',
    );
    await tester.tap(find.text('Land on main'));
    expect(landed, ['main']);
    await tester.tap(find.byIcon(Icons.expand_more));
    await tester.pumpAndSettle();
    expect(find.text('Other…'), findsOneWidget);
    final releaseY = tester.getTopLeft(find.text('release').last).dy;
    final mainY = tester.getTopLeft(find.text('main').last).dy;
    expect(
      releaseY,
      lessThan(mainY),
      reason: 'the remembered target comes first in the menu',
    );
    await tester.tap(find.text('release').last);
    await tester.pumpAndSettle();
    expect(landed, ['main', 'release']);
  });

  testWidgets('a landed repo row, with a prod to ship to', (tester) async {
    await _shoot(
      tester,
      'repo-card-prod',
      Padding(
        padding: const EdgeInsets.all(16),
        child: RepoCard(
          repo: const {
            'repo': 'mobile-admin-shopify',
            'branch': 'flow/discount-names-a1b2c3d4',
            'base': 'main',
            'ahead': 0,
            'behind': 0,
            'unpushed': 0,
            'baseUnpushed': 0,
            'remote': 'origin',
            'reviewUrl': 'https://gitlab.example.com/x/-/merge_requests/12',
            'pipeline': {
              'status': 'success',
              'url': 'https://gitlab.example.com/p/1',
            },
            'mergeBlockedBy': null,
            'prod': {
              'branch': 'prod',
              'exists': true,
              'toPick': 2,
              'picked': 0,
              'jenkins': {
                'url': 'https://jenkins.example.com',
                'job': 'admin-prod',
                'user': 'ci',
              },
            },
          },
          busy: '',
          onPush: () {},
          onPushBase: () {},
          onMerge: (_) {},
          onCatchUp: () {},
          onShip: () {},
          onConfigureProd: () {},
        ),
      ),
      const Size(430, 250),
    );
    expect(find.text('Ship to prod (2)'), findsOneWidget);
    expect(find.text('Jenkins admin-prod'), findsOneWidget);
    expect(find.text('Land on main'), findsOneWidget);
  });

  testWidgets('prod can be configured per repo', (tester) async {
    await _shoot(
      tester,
      'prod-config-dialog',
      const Center(
        child: ProdConfigDialog(
          repo: 'mobile-admin-shopify',
          config: {
            'prodBranch': 'prod',
            'jenkins': {
              'url': 'https://jenkins.example.com',
              'job': 'admin-prod',
              'user': 'ci',
            },
            'hasJenkinsToken': true,
            'setup': 'pnpm install --frozen-lockfile',
            'copy': ['@types/api-routes.d.ts'],
            'checks': ['pnpm tsc', 'pnpm verify-all'],
          },
        ),
      ),
      const Size(640, 720),
    );
    expect(find.text('Setup command'), findsOneWidget);
    expect(find.text('pnpm tsc\npnpm verify-all'), findsOneWidget);
    expect(find.text('Prod branch'), findsOneWidget);
    expect(find.text('Jenkins job'), findsOneWidget);
    expect(find.textContaining('token is set'), findsOneWidget);
  });

  testWidgets('the prompts, listed and editable', (tester) async {
    final flow = _flow();
    await _shoot(
      tester,
      'prompts',
      PromptsScreen(
        flow: flow,
        initial: [
          {
            'name': 'answer',
            'about': 'The plain route: one run, no documents, no review.',
            'placeholders': ['preamble', 'prompt', 'titleAsk'],
            'default': '{{preamble}}\n\n## What the human asked\n\n{{prompt}}\n\nDo this, and nothing around it.',
            'custom': '{{preamble}}\n\n## What the human asked\n\n{{prompt}}\n\nDo this, and say so in Vietnamese.',
          },
          {
            'name': 'spec',
            'about': 'The spec phase of the full route.',
            'placeholders': [
              'preamble',
              'prompt',
              'artifactDir',
              'many',
              'titleAsk',
            ],
            'default': '{{preamble}}\n\n## Phase: write the spec',
            'custom': null,
          },
        ],
      ),
      const Size(1100, 600),
    );
    expect(find.text('Save'), findsOneWidget);
    expect(find.text('Reset to default'), findsOneWidget);
    expect(find.text('spec'), findsOneWidget);
    expect(
      find.textContaining('{{preamble}}, {{prompt}}, {{titleAsk}}'),
      findsOneWidget,
    );
  });

  testWidgets('the status line says what it did and what it needs', (
    tester,
  ) async {
    final task = _task({
      'status': 'awaiting_answer',
      'phase': null,
      'questions': [
        {'id': 'q1', 'text': 'Keep the old column or drop it?', 'answer': null},
      ],
      'log': [
        {
          'kind': 'text',
          'text': 'Found that the migration drops a column still read by the cron. Stopping here.',
        },
      ],
    });
    var jumped = 0;
    await _shoot(
      tester,
      'status-line',
      StatusLine(task: task, onJump: () => jumped++),
      const Size(900, 60),
    );
    expect(find.textContaining('Found that the migration'), findsOneWidget);
    expect(find.textContaining('Keep the old column'), findsOneWidget);
    await tester.tap(find.byType(StatusLine));
    expect(jumped, 1);
  });

  testWidgets('a document task shows what it produced instead of a diff', (
    tester,
  ) async {
    final flow = _flow();
    final task = _task({
      'run': 'doc',
      'status': 'done',
      'phase': null,
      'trees': const [],
      'root': '/data/tasks/a1b2c3d4/work',
      'artifactDir': '/data/tasks/a1b2c3d4',
      'phases': {
        'write': {'status': 'done'},
      },
      'log': [
        {'kind': 'text', 'text': 'Wrote estimate.md and the figures as a CSV.'},
      ],
    });
    await _shoot(
      tester,
      'workspace-doc',
      WorkspaceScreen(
        flow: flow,
        task: task,
        prefs: Prefs.memory(),
        outputInitial: const [
          {'name': 'estimate.md', 'bytes': 1832, 'mtime': 2},
          {'name': 'figures.csv', 'bytes': 410, 'mtime': 1},
        ],
        outputTextInitial: '# Estimate\n\nThree days, give or take.',
      ),
      const Size(1340, 700),
    );
    expect(find.text('Output'), findsOneWidget);
    expect(find.text('estimate.md'), findsOneWidget);
    expect(find.text('figures.csv'), findsOneWidget);
    expect(find.text('Three days, give or take.'), findsOneWidget);
    expect(find.text('Changes'), findsNothing);
  });

  testWidgets(
    'a plain task that wrote a document is offered the Document route',
    (tester) async {
      final flow = _flow();
      final task = _task({'status': 'done', 'phase': null, 'hasOutput': true});
      tester.view.physicalSize = const Size(1340, 700);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          theme: ternTheme(Accent.sky),
          home: Scaffold(
            body: WorkspaceScreen(
              flow: flow,
              task: task,
              prefs: Prefs.memory(),
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 60));
      expect(find.textContaining('Document route'), findsOneWidget);
      expect(find.text('Switch'), findsOneWidget);
      await tester.pump(const Duration(seconds: 6));
    },
  );

  testWidgets('a file name in a message is a click away from Finder', (
    tester,
  ) async {
    final names = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        theme: ternTheme(Accent.sky),
        home: Scaffold(
          body: MarkdownView(
            'Changed `omise-hold-refund-estimate.xlsx` and `app/services/discount.server.ts`; see `foo()` and `--ff-only`.',
            onFile: names.add,
          ),
        ),
      ),
    );
    await tester.pump();
    final rich = tester.widget<SelectableText>(find.byType(SelectableText));
    final spans = <TextSpan>[];
    rich.textSpan!.visitChildren((s) {
      if (s is TextSpan) spans.add(s);
      return true;
    });
    final tappable = spans
        .where((s) => s.recognizer is TapGestureRecognizer)
        .map((s) => s.text)
        .toList();
    expect(tappable, [
      'omise-hold-refund-estimate.xlsx',
      'app/services/discount.server.ts',
    ]);
    for (final s in spans) {
      if (s.recognizer is TapGestureRecognizer)
        (s.recognizer as TapGestureRecognizer).onTap!();
    }
    expect(names, [
      'omise-hold-refund-estimate.xlsx',
      'app/services/discount.server.ts',
    ]);
  });

  testWidgets('a document in the explorer opens in the right pane', (
    tester,
  ) async {
    final flow = _flow();
    final task = _task({
      'status': 'awaiting_approval',
      'awaitingPhase': 'spec',
      'phase': null,
      'docs': {'spec.md': '# The spec\n\nIntent: keep the old column.'},
    });
    tester.view.physicalSize = const Size(1340, 700);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        theme: ternTheme(Accent.sky),
        home: Scaffold(
          body: WorkspaceScreen(flow: flow, task: task, prefs: Prefs.memory()),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Intent: keep the old column.'), findsNothing);
    await tester.tap(find.text('spec.md'));
    await tester.pump();
    expect(
      find.text('Intent: keep the old column.'),
      findsOneWidget,
      reason: 'rendered in the pane',
    );
    expect(
      find.text('spec.md'),
      findsNWidgets(2),
      reason: 'and named in the pane header',
    );
    await tester.pump(const Duration(seconds: 6));
  });

  testWidgets(
    'the sidebar lists the conversations touched most recently, not the newest',
    (tester) async {
      final flow = _flow();
      flow.tasks = [
        _task({
          'id': 'n1',
          'title': 'Newest but idle',
          'createdAt': 300,
          'updatedAt': 300,
          'status': 'done',
          'phase': null,
        }),
        _task({
          'id': 'o1',
          'title': 'Old but just talked to',
          'createdAt': 100,
          'updatedAt': 900,
          'status': 'done',
          'phase': null,
        }),
        _task({
          'id': 'o2',
          'title': 'Old and idle',
          'createdAt': 50,
          'status': 'done',
          'phase': null,
        }),
      ];
      tester.view.physicalSize = const Size(244, 460);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          theme: ternTheme(Accent.sky),
          home: Scaffold(
            body: Sidebar(
              flow: flow,
              onOpen: (_) {},
              onPick: (_) {},
              recent: 2,
            ),
          ),
        ),
      );
      await tester.pump();
      final talked = tester.getTopLeft(find.text('Old but just talked to')).dy;
      final idle = tester.getTopLeft(find.text('Newest but idle')).dy;
      expect(
        talked,
        lessThan(idle),
        reason: 'the one talked to last comes first',
      );
      expect(
        find.text('Old and idle'),
        findsNothing,
        reason: 'and the last five are by activity, so this one drops off',
      );
    },
  );

  testWidgets(
    'what the review left is a checklist, and the fixable ones are one click',
    (tester) async {
      final api = _CapturingApi();
      final flow = FlowState(api);
      addTearDown(flow.dispose);
      flow.live = true;
      const review =
          '## 1. Correctness\nok\n\n## Left\n'
          '- [ ] fixable: null on error in useGetLatestSubmission.ts\n'
          '- [ ] fixable: duplicated toast block\n'
          '- [x] fixable: already ticked\n'
          '- [ ] decision: should the API block scheduling too?\n';
      final task = _task({
        'status': 'done',
        'phase': null,
        'docs': {'review.md': review},
      });
      tester.view.physicalSize = const Size(1340, 700);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          theme: ternTheme(Accent.sky),
          home: Scaffold(
            body: WorkspaceScreen(
              flow: flow,
              task: task,
              prefs: Prefs.memory(),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Left (4)'), findsOneWidget);
      expect(find.textContaining('duplicated toast block'), findsOneWidget);
      expect(
        find.text('Fix the 2 left'),
        findsOneWidget,
        reason: 'two fixable and not ticked',
      );
      await tester.tap(find.text('Fix the 2 left'));
      await tester.pump();
      expect(api.sent, [
        'Fix every item tagged fixable under ## Left in review.md, re-run the checks, and tick them off in review.md.',
      ]);
      await tester.pump(const Duration(seconds: 6));
    },
  );

  testWidgets('only decisions left means a list and no button', (tester) async {
    final flow = _flow();
    final task = _task({
      'status': 'done',
      'phase': null,
      'docs': {'review.md': '## Left\n- [ ] decision: keep both?\n'},
    });
    tester.view.physicalSize = const Size(1340, 700);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        theme: ternTheme(Accent.sky),
        home: Scaffold(
          body: WorkspaceScreen(flow: flow, task: task, prefs: Prefs.memory()),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Left (1)'), findsOneWidget);
    expect(find.textContaining('Fix the'), findsNothing);
    await tester.pump(const Duration(seconds: 6));
  });

  testWidgets('once on the base, another target is still a click away', (
    tester,
  ) async {
    final landed = <String>[];
    tester.view.physicalSize = const Size(600, 400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        theme: ternTheme(Accent.sky),
        home: Scaffold(
          body: RepoCard(
            repo: const {
              'repo': 'web',
              'branch': 'flow/x-1',
              'base': 'dev',
              'ahead': 0,
              'behind': 0,
              'unpushed': 0,
              'baseUnpushed': 0,
              'remote': 'origin',
              'targets': ['dev', 'main'],
              'landTarget': null,
            },
            busy: '',
            onPush: () {},
            onPushBase: () {},
            onMerge: landed.add,
            onCatchUp: () {},
            onShip: () {},
            onConfigureProd: () {},
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.text('Land on dev'));
    expect(landed, isEmpty, reason: 'nothing left for the base');
    await tester.tap(find.byIcon(Icons.expand_more));
    await tester.pumpAndSettle();
    await tester.tap(find.text('main').last);
    await tester.pumpAndSettle();
    expect(landed, ['main']);
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
      _task({
        'id': 'old',
        'repos': ['warehouse-api'],
        'repoPaths': null,
      }),
    ];

    expect(flow.rootOf(flow.tasks![0]), '/w/mobile-builder');
    expect(flow.rootOf(flow.tasks![1]), '/w/logistek');
    expect(
      flow.rootOf(flow.tasks![2]),
      '/w/logistek',
      reason: 'a task stored before repo paths were still has repo names',
    );

    flow.pickWorkspace('/w/logistek');
    expect(flow.visible.map((t) => t.id), ['e5', 'old']);
    flow.pickWorkspace(null);
    expect(
      flow.visible,
      hasLength(3),
      reason: 'no workspace means all of them',
    );
  });

  testWidgets('the shortcuts fire even while a field has focus', (
    tester,
  ) async {
    // The bug this is about was not the bindings: a shortcut is only seen on
    // its way up from whatever has focus, so with nothing focused inside the
    // subtree holding them, Cmd-\\ reached nothing at all.
    var sidebar = 0;
    final picked = <int>[];
    var everything = 0;

    await tester.pumpWidget(
      MaterialApp(
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
      ),
    );
    await tester.pump();

    Future<void> press(LogicalKeyboardKey key) async {
      await tester.sendKeyDownEvent(LogicalKeyboardKey.meta);
      await tester.sendKeyEvent(key);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.meta);
      await tester.pump();
    }

    await press(LogicalKeyboardKey.backslash);
    expect(
      sidebar,
      1,
      reason: 'Cmd-\\ has to reach the window, not the text field',
    );

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

    await tester.pumpWidget(
      MaterialApp(
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
      ),
    );

    expect(
      tester.getCenter(find.byType(Mark)).dy,
      closeTo(26, 1.5),
      reason: 'level with the middle of the traffic lights',
    );

    // Whatever comes first in the bar is the thing that has to clear them.
    final leading = tester.getTopLeft(find.byIcon(Icons.menu_open)).dx;
    expect(
      leading,
      greaterThanOrEqualTo(79),
      reason: 'the lights end at 79 and nothing may sit on top of them',
    );
    expect(
      leading,
      lessThan(120),
      reason: 'but not pushed halfway across either',
    );
  });

  testWidgets('full screen stops leaving room for lights that are gone', (
    tester,
  ) async {
    final flow = _flow();
    tester.view.physicalSize = const Size(1340, 120);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
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
      ),
    );

    expect(
      tester.getTopLeft(find.byIcon(Icons.menu_open)).dx,
      lessThan(40),
      reason: 'there are no traffic lights in full screen to clear',
    );
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
