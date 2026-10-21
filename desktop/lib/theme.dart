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

/// Depth.
///
/// The five Tern surfaces sit within a few points of luminance of each other,
/// so a 1px border was doing all the work of separating them and the app read
/// flat. On the web the fix is `inset 0 1px 0 rgb(255 255 255 / .05)`: a
/// hairline of light along the top edge, which is what actually tells the eye a
/// surface is raised. The shadow underneath only confirms it.
///
/// Flutter has no inset shadow, and it refuses a borderRadius on a Border whose
/// sides differ in colour. So the light cannot be a brighter top BorderSide:
/// on a rounded surface that throws during paint, and in this app every surface
/// is rounded.
///
/// It goes in two places instead. [raised] lightens the whole outline, which is
/// uniform and so survives the radius; [litFill] puts the actual hairline into
/// the surface's own fill as a gradient that is brightest at the top edge and
/// has settled to the base colour a few percent down.
Border raised(Color colour, {double light = 0.07}) => Border.all(
      color: Color.alphaBlend(Colors.white.withValues(alpha: light), colour),
    );

/// The top-edge light, as a fill. Only for opaque surfaces: run it on a
/// transparent one and the gradient paints a grey ghost where nothing should be.
LinearGradient litFill(Color surface, {double light = 0.045}) => LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: [
        Color.alphaBlend(Colors.white.withValues(alpha: light), surface),
        surface,
      ],
      stops: const [0.0, 0.06],
    );

/// Three steps of elevation, tuned to the same values the web tokens use.
/// Shadows are never pure black at full strength: on a near-black page that
/// reads as a hole rather than as height.
const e1 = <BoxShadow>[
  BoxShadow(color: Color(0x99000000), blurRadius: 2, spreadRadius: -1, offset: Offset(0, 1)),
];

const e2 = <BoxShadow>[
  BoxShadow(color: Color(0x66000000), blurRadius: 2, offset: Offset(0, 1)),
  BoxShadow(color: Color(0xA6000000), blurRadius: 16, spreadRadius: -6, offset: Offset(0, 6)),
];

const e3 = <BoxShadow>[
  BoxShadow(color: Color(0x66000000), blurRadius: 6, offset: Offset(0, 2)),
  BoxShadow(color: Color(0xCC000000), blurRadius: 44, spreadRadius: -14, offset: Offset(0, 18)),
];

/// The accent's own glow. Only the one primary action on a screen wears it, and
/// it is the accent's hue, never a generic neon ring.
List<BoxShadow> accentGlow(Color accent, {bool lifted = false}) => [
      BoxShadow(color: const Color(0x80000000), blurRadius: 2, offset: const Offset(0, 1)),
      BoxShadow(
        color: accent.withValues(alpha: lifted ? 0.60 : 0.45),
        blurRadius: lifted ? 32 : 22,
        spreadRadius: -8,
        offset: Offset(0, lifted ? 14 : 8),
      ),
    ];

/// One easing and two durations, so motion across the app agrees with itself.
/// The curve is the same cubic-bezier(0.16, 1, 0.3, 1) the web side uses.
const ease = Cubic(0.16, 1, 0.3, 1);
const fast = Duration(milliseconds: 140);
const smooth = Duration(milliseconds: 220);

/// 20, 26.3k, 753k, 7.4M. Tight enough to sit in a column.
String tokens(num n) {
  if (n <= 0) return '0';
  if (n < 1000) return '$n';
  if (n < 1000000) {
    return n < 100000
        ? '${(n / 1000).toStringAsFixed(1)}k'
        : '${(n / 1000).round()}k';
  }
  return '${(n / 1000000).toStringAsFixed(1)}M';
}
