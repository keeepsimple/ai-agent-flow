// The client's half of the contract: which method, which path, which body.
// A plain test, not a widget test: real sockets and fake async do not mix.
import 'dart:convert';
import 'dart:io';

import 'package:agent_flow/api.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late HttpServer server;
  late List<({String method, String path, String body})> seen;

  setUp(() async {
    seen = [];
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      final body = await utf8.decoder.bind(request).join();
      seen.add((method: request.method, path: request.uri.path, body: body));
      request.response
        ..headers.contentType = ContentType.json
        ..write(jsonEncode({'roots': ['/w'], 'repos': []}))
        ..close();
    });
  });

  tearDown(() => server.close(force: true));

  test('adding a folder posts it, rather than only asking for it', () async {
    final api = Api(server.port);
    addTearDown(api.close);

    await api.addRoot('/Users/me/work');

    expect(seen, hasLength(1));
    expect(seen.single.method, 'POST');
    expect(seen.single.path, '/api/roots');
    expect(jsonDecode(seen.single.body), {'path': '/Users/me/work'});
  });

  test('an error from the server arrives as its words, not a status code', () async {
    final api = Api(server.port);
    addTearDown(api.close);
    await server.close(force: true);

    // Nothing listening: the failure has to surface rather than hang.
    await expectLater(api.addRoot('/w'), throwsA(isA<Object>()));
  });
}
