import 'dart:io';

import 'package:flutter/material.dart';

/// The Tern tokens, read off the same artboards the web UI was built to.
/// Kept as plain constants: there is one theme and it is not configurable.
/// The Tern palette. Named for the artboards, not for Flutter's Ink widget,
/// which this would otherwise shadow everywhere Material is imported.
class Tern {
  static const page = Color(0xFF0B0C0E);
  static const panel = Color(0xFF0E0F12);
  static const raised = Color(0xFF111215);
  static const input = Color(0xFF131418);
  static const selected = Color(0xFF1A1C21);
  static const avatar = Color(0xFF2A2D35);

  static const line = Color(0xFF23262D);
  static const lineStrong = Color(0xFF2E323A);
  static const lineDim = Color(0xFF1C1E23);

  static const ink = Color(0xFFEDEEF0);
  static const ink2 = Color(0xFFDADDE2);
  static const ink3 = Color(0xFFC9CDD4);
  static const muted = Color(0xFF9097A3);
  static const faint = Color(0xFF4A4F59);
  static const dim = Color(0xFF3A3E47);
  static const ghost = Color(0xFF6B717C);

  static const onAccent = Color(0xFF0B0C0E);
  static const ok = Color(0xFF4ADE80);
  static const bad = Color(0xFFFF8080);
  static const warn = Color(0xFFFFB86B);
  static const info = Color(0xFF7DD3FC);

  static const warnLine = Color(0xFF5C4A2A);
  static const warnBg = Color(0xFF17140F);

  static const added = Color(0xFF14241A);
  static const removed = Color(0xFF2A1619);
}

/// The artboard offers four; the choice is remembered server-side in neither,
/// so it lives in the app and defaults to the one the boards were drawn with.
enum Accent {
  sky('Sky', Color(0xFF7DD3FC)),
  lime('Lime', Color(0xFFBEF264)),
  amber('Amber', Color(0xFFFCD34D)),
  violet('Violet', Color(0xFFC4B5FD));

  const Accent(this.label, this.color);
  final String label;
  final Color color;
}

/// Geist has no ⌘ and no ↵, so the hint is spelled out. It also has to
/// read right on Windows, where ⌘ means nothing anyway.
final sendHint = Platform.isMacOS ? 'Cmd+Enter' : 'Ctrl+Enter';

const sans = 'Geist';
const mono = 'GeistMono';

ThemeData ternTheme(Accent accent) {
  final base = ThemeData.dark(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: Tern.page,
    canvasColor: Tern.page,
    colorScheme: base.colorScheme.copyWith(
      primary: accent.color,
      onPrimary: Tern.onAccent,
      surface: Tern.panel,
      error: Tern.bad,
    ),
    textTheme: base.textTheme.apply(
      fontFamily: sans,
      bodyColor: Tern.ink,
      displayColor: Tern.ink,
    ),
    dividerColor: Tern.line,
    splashFactory: NoSplash.splashFactory,
    tooltipTheme: const TooltipThemeData(
      decoration: BoxDecoration(
        color: Tern.raised,
        borderRadius: BorderRadius.all(Radius.circular(6)),
      ),
      textStyle: TextStyle(color: Tern.ink2, fontSize: 11, fontFamily: sans),
    ),
    scrollbarTheme: ScrollbarThemeData(
      thumbColor: WidgetStateProperty.all(Tern.lineStrong),
      radius: const Radius.circular(6),
      thickness: WidgetStateProperty.all(8),
    ),
  );
}

/// Shorthands used everywhere, so a size is never typed twice.
TextStyle t(double size,
        {Color color = Tern.ink2,
        FontWeight weight = FontWeight.w400,
        bool code = false,
        double? height}) =>
    TextStyle(
      fontFamily: code ? mono : sans,
      fontSize: size,
      color: color,
      fontWeight: weight,
      height: height,
    );
