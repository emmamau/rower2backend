import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Alerte visuelle et haptique en cas de faux départ ou de mouvement détecté
/// pendant la phase de décompte (T <= 15s) ou au signal de départ (T = 0).
class FalseStartOverlay extends StatefulWidget {
  final bool isCountingDownWarning;
  final bool isStartBlockedWarning;
  final int countdownSeconds;

  const FalseStartOverlay({
    super.key,
    required this.isCountingDownWarning,
    required this.isStartBlockedWarning,
    required this.countdownSeconds,
  });

  @override
  State<FalseStartOverlay> createState() => _FalseStartOverlayState();
}

class _FalseStartOverlayState extends State<FalseStartOverlay>
    with SingleTickerProviderStateMixin {
  late AnimationController _blinkController;
  late Animation<double> _opacityAnimation;

  @override
  void initState() {
    super.initState();
    _blinkController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 350),
    )..repeat(reverse: true);

    _opacityAnimation = Tween<double>(begin: 0.25, end: 0.85).animate(
      CurvedAnimation(parent: _blinkController, curve: Curves.easeInOut),
    );

    _triggerHaptics();
  }

  @override
  void didUpdateWidget(covariant FalseStartOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isCountingDownWarning || widget.isStartBlockedWarning) {
      _triggerHaptics();
    }
  }

  void _triggerHaptics() {
    if (widget.isCountingDownWarning || widget.isStartBlockedWarning) {
      HapticFeedback.heavyImpact();
    }
  }

  @override
  void dispose() {
    _blinkController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isCountingDownWarning && !widget.isStartBlockedWarning) {
      return const SizedBox.shrink();
    }

    if (widget.isCountingDownWarning) {
      return AnimatedBuilder(
        animation: _opacityAnimation,
        builder: (context, child) {
          return Container(
            color: Colors.red.withOpacity(_opacityAnimation.value),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.warning_amber_rounded,
                  color: Colors.white,
                  size: 72,
                ),
                const SizedBox(height: 12),
                const Text(
                  'ARRÊTEZ DE RAMER !',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 26,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 2.0,
                    shadows: [
                      Shadow(
                        blurRadius: 10,
                        color: Colors.black,
                        offset: Offset(0, 3),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'DÉPART ARRÊTÉ DANS ${widget.countdownSeconds}s',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.2,
                  ),
                ),
                const SizedBox(height: 4),
                const Text(
                  'Tout mouvement avant le signal de départ sera sanctionné.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white70,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          );
        },
      );
    }

    // isStartBlockedWarning (T = 0, rameur en mouvement)
    return Positioned(
      top: 16,
      left: 20,
      right: 20,
      child: Material(
        color: Colors.transparent,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: const Color(0xFFD32F2F),
            borderRadius: BorderRadius.circular(10),
            boxShadow: const [
              BoxShadow(
                color: Colors.black54,
                blurRadius: 12,
                offset: Offset(0, 4),
              ),
            ],
            border: Border.all(color: Colors.white.withOpacity(0.5), width: 1.5),
          ),
          child: Row(
            children: [
              const Icon(Icons.error_outline, color: Colors.white, size: 28),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: const [
                    Text(
                      'DÉPART RATÉ !',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w900,
                        fontSize: 15,
                        letterSpacing: 1.0,
                      ),
                    ),
                    Text(
                      'Arrêtez complètement le rameur (0 W) pour débloquer le départ.',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
