import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';

/// Two fingers sideways on a pane, to step between the screens it belongs to.
///
/// macOS delivers a trackpad swipe two different ways: as pan events once the
/// system has decided the gesture is a pan, and as plain scroll signals before
/// or instead of that. Which one arrives is not something this gets to choose,
/// so it reads both and treats them the same.
class SwipeBetween extends StatefulWidget {
  const SwipeBetween({
    super.key,
    required this.child,
    this.onNext,
    this.onBack,
    this.threshold = 70,
  });

  final Widget child;

  /// The gesture that moves content left, bringing the next screen in.
  final VoidCallback? onNext;

  /// The same, the other way.
  final VoidCallback? onBack;

  /// How far it has to travel before it counts. Low enough to feel willing,
  /// high enough that a crooked vertical flick does not switch the screen.
  final double threshold;

  @override
  State<SwipeBetween> createState() => _SwipeBetweenState();
}

class _SwipeBetweenState extends State<SwipeBetween> {
  double _dx = 0;
  bool _fired = false;
  Timer? _idle;

  @override
  void dispose() {
    _idle?.cancel();
    super.dispose();
  }

  void _reset() {
    _idle?.cancel();
    _idle = null;
    _dx = 0;
    _fired = false;
  }

  void _feed(double dx, double dy) {
    // One switch per gesture. Momentum keeps the events coming long after the
    // fingers are gone, and without this a single flick walks the tabs.
    if (_fired) return;

    // Vertical wins. This pane is a list, and a list that will not scroll
    // because a sideways reading took the gesture is worse than no gesture.
    if (dy.abs() > dx.abs()) {
      _dx = 0;
      return;
    }

    _dx += dx;
    if (_dx.abs() < widget.threshold) return;

    _fired = true;
    final go = _dx < 0 ? widget.onNext : widget.onBack;
    _dx = 0;
    go?.call();
  }

  /// A scroll signal has no end event, so a quiet moment is the end.
  void _arm() {
    _idle?.cancel();
    _idle = Timer(const Duration(milliseconds: 220), _reset);
  }

  @override
  Widget build(BuildContext context) => Listener(
    // Opaque, so the gesture is read across the whole pane and not only where
    // the child happens to paint something. Children are hit-tested first and
    // still get everything: this only adds the listener to the path.
    behavior: HitTestBehavior.opaque,
    onPointerSignal: (event) {
      if (event is! PointerScrollEvent) return;
      _feed(event.scrollDelta.dx, event.scrollDelta.dy);
      _arm();
    },
    onPointerPanZoomStart: (_) => _reset(),
    onPointerPanZoomUpdate: (event) =>
        _feed(event.panDelta.dx, event.panDelta.dy),
    onPointerPanZoomEnd: (_) => _reset(),
    child: widget.child,
  );
}
