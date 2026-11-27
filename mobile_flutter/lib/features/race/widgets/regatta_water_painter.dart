import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import '../models/live_racer_metric.dart';

class RegattaWaterView extends StatefulWidget {
  final List<LiveRacerMetric> racers;
  final int targetDistance;
  final String myUserId;
  final bool dynamicLaneMode;
  final double zoomLevel; // 1.0 à 3.0

  const RegattaWaterView({
    super.key,
    required this.racers,
    required this.targetDistance,
    required this.myUserId,
    this.dynamicLaneMode = true,
    this.zoomLevel = 1.0,
  });

  @override
  State<RegattaWaterView> createState() => _RegattaWaterViewState();
}

class _RegattaWaterViewState extends State<RegattaWaterView> with SingleTickerProviderStateMixin {
  late final AnimationController _ticker;
  final Map<String, BoatRenderState> _boatsMap = {};
  double _lastTimestamp = 0.0;

  final List<Color> _defaultBoatColors = const [
    Color(0xFFFF0055),
    Color(0xFF00F0FF),
    Color(0xFF39FF14),
    Color(0xFFFFE600),
    Color(0xFFFF6600),
    Color(0xFFB026FF),
    Color(0xFF00FF9D),
    Color(0xFFFF3366),
  ];

  @override
  void initState() {
    super.initState();
    _ticker = AnimationController(vsync: this, duration: const Duration(seconds: 1))
      ..repeat();
  }

  @override
  void dispose() {
    _ticker.dispose();
    super.dispose();
  }

  void _syncRacers() {
    final activeIds = <String>{};

    for (int i = 0; i < widget.racers.length; i++) {
      final r = widget.racers[i];
      activeIds.add(r.userId);

      final clamped = widget.targetDistance > 0
          ? math.min(widget.targetDistance, r.dist)
          : r.dist;
      final assigned = r.lane > 0 ? r.lane : (i + 1);

      if (!_boatsMap.containsKey(r.userId)) {
        _boatsMap[r.userId] = BoatRenderState(
          userId: r.userId,
          name: r.name,
          lane: assigned,
          assignedLane: assigned,
          dynamicLaneIndex: math.max(0, assigned - 1),
          currentLaneIndex: (assigned - 1).toDouble(),
          currentDisplayDist: clamped.toDouble(),
          targetPacketDist: clamped.toDouble(),
          splitSec: r.split > 0 ? r.split : 120,
          watts: r.watts,
          spm: r.spm,
          status: r.status,
          ready: r.ready,
          connectionState: r.connectionState,
          isBot: r.isBot,
          isPaired: r.isPaired,
          kayak: r.kayak,
        );
      } else {
        final b = _boatsMap[r.userId]!;
        b.name = r.name;
        b.assignedLane = assigned;
        b.targetPacketDist = widget.targetDistance > 0
            ? math.min(widget.targetDistance.toDouble(), math.max(b.targetPacketDist, clamped.toDouble()))
            : math.max(b.targetPacketDist, clamped.toDouble());
        b.splitSec = r.split > 0 ? r.split : b.splitSec;
        b.watts = r.watts;
        b.spm = r.spm;
        b.status = r.status;
        b.ready = r.ready;
        b.connectionState = r.connectionState;
        b.isBot = r.isBot;
        b.isPaired = r.isPaired;
        b.kayak = r.kayak;
      }
    }

    _boatsMap.removeWhere((id, _) => !activeIds.contains(id));
  }

  void _updatePhysics(double deltaT) {
    if (widget.dynamicLaneMode && _boatsMap.length > 1) {
      final list = _boatsMap.values.toList();
      // Tri par distance actuelle
      list.sort((a, b) => b.currentDisplayDist.compareTo(a.currentDisplayDist));
      for (int i = 0; i < list.length; i++) {
        list[i].dynamicLaneIndex = i;
      }
    }

    for (final b in _boatsMap.values) {
      final targetLaneIdx = widget.dynamicLaneMode
          ? b.dynamicLaneIndex.toDouble()
          : (b.assignedLane - 1).toDouble();

      final diffY = targetLaneIdx - b.currentLaneIndex;
      if (diffY.abs() < 0.005) {
        b.currentLaneIndex = targetLaneIdx;
      } else {
        b.currentLaneIndex += diffY * math.min(1.0, deltaT * 3.5);
      }

      // Règle d'or : le kayak ne recule jamais sur l'eau (monotonie absolue)
      final prevDisplay = b.currentDisplayDist;
      final diffX = b.targetPacketDist - b.currentDisplayDist;
      if (diffX > 0) {
        if (diffX < 0.8) {
          b.currentDisplayDist = b.targetPacketDist;
        } else {
          b.currentDisplayDist = math.min(
            b.targetPacketDist,
            b.currentDisplayDist + math.max(0.15, diffX * 0.30),
          );
        }
      }
      b.currentDisplayDist = math.max(prevDisplay, b.currentDisplayDist);
    }
  }

  @override
  Widget build(BuildContext context) {
    _syncRacers();

    return AnimatedBuilder(
      animation: _ticker,
      builder: (context, _) {
        final now = DateTime.now().millisecondsSinceEpoch / 1000.0;
        final deltaT = _lastTimestamp == 0.0 ? 0.016 : math.min(0.1, now - _lastTimestamp);
        _lastTimestamp = now;

        _updatePhysics(deltaT);

        return CustomPaint(
          size: Size.infinite,
          painter: _RegattaCustomPainter(
            boats: _boatsMap.values.toList(),
            targetDistance: widget.targetDistance > 0 ? widget.targetDistance : 2000,
            myUserId: widget.myUserId,
            zoomLevel: widget.zoomLevel,
            nowSec: now,
            defaultColors: _defaultBoatColors,
          ),
        );
      },
    );
  }
}

class _RegattaCustomPainter extends CustomPainter {
  final List<BoatRenderState> boats;
  final int targetDistance;
  final String myUserId;
  final double zoomLevel;
  final double nowSec;
  final List<Color> defaultColors;

  _RegattaCustomPainter({
    required this.boats,
    required this.targetDistance,
    required this.myUserId,
    required this.zoomLevel,
    required this.nowSec,
    required this.defaultColors,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    // 1. Fond plan d'eau dégradé sombre
    final bgPaint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [Color(0xFF0D1E3D), Color(0xFF060D1D)],
      ).createShader(Rect.fromLTWH(0, 0, w, h));
    canvas.drawRect(Rect.fromLTWH(0, 0, w, h), bgPaint);

    final boatCount = math.max(1, boats.length);
    const topMargin = 38.0;
    const bottomMargin = 16.0;
    const leftMargin = 54.0;
    const rightMargin = 32.0;

    final trackW = math.max(80.0, w - leftMargin - rightMargin);
    final availableH = math.max(40.0, h - topMargin - bottomMargin);
    final laneH = availableH / boatCount;

    // 2. Lignes d'eau et repères de distance
    final markerPaint = Paint()
      ..color = const Color(0x2800F0FF)
      ..strokeWidth = 1.0;

    final markerPcts = [0.0, 0.25, 0.5, 0.75, 1.0];
    for (final pct in markerPcts) {
      final x = leftMargin + trackW * pct;
      canvas.drawLine(Offset(x, topMargin), Offset(x, topMargin + boatCount * laneH), markerPaint);

      // Texte de repère kilométrique
      final textSpan = TextSpan(
        text: '${(pct * targetDistance).round()}m',
        style: const TextStyle(
          color: Color(0xBB00F0FF),
          fontSize: 10,
          fontWeight: FontWeight.w700,
          fontFamily: 'monospace',
        ),
      );
      final tp = TextPainter(text: textSpan, textDirection: TextDirection.ltr)..layout();
      tp.paint(canvas, Offset(x - tp.width / 2, topMargin - 18));
    }

    // Ligne d'arrivée dorée
    final finishX = leftMargin + trackW;
    final finishPaint = Paint()
      ..color = AppColors.yellow
      ..strokeWidth = 2.5;
    canvas.drawLine(Offset(finishX, topMargin), Offset(finishX, topMargin + boatCount * laneH), finishPaint);

    // Séparateurs de couloirs et témoins d'état BLE
    final separatorPaint = Paint()
      ..color = const Color(0x1FFFFFFF)
      ..strokeWidth = 1.0;

    for (int l = 0; l <= boatCount; l++) {
      final y = topMargin + l * laneH;
      canvas.drawLine(Offset(leftMargin, y), Offset(finishX, y), separatorPaint);

      // Bouées de balisage rouges
      for (final pct in markerPcts) {
        final bx = leftMargin + trackW * pct;
        final buoyPaint = Paint()..color = (pct == 1.0 ? AppColors.yellow : AppColors.red);
        canvas.drawCircle(Offset(bx, y), pct == 1.0 ? 3.0 : 2.0, buoyPaint);
      }
    }

    // 3. Dessin des embarcations
    for (int i = 0; i < boats.length; i++) {
      final boat = boats[i];
      final y = topMargin + (boat.currentLaneIndex + 0.5) * laneH;

      // Numéro de ligne d'eau
      final laneLabel = 'L${boat.assignedLane}';
      final isMe = boat.userId == myUserId;
      final laneTp = TextPainter(
        text: TextSpan(
          text: laneLabel,
          style: TextStyle(
            color: isMe ? AppColors.cyan : AppColors.textMuted,
            fontSize: 11,
            fontWeight: FontWeight.w800,
            fontFamily: 'monospace',
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      laneTp.paint(canvas, Offset(18, y - laneTp.height / 2));

      // Voyant lumineux BLE : Orange = CONNECTED (attente rameur), Vert = READY (rameur réveillé)
      final isReady = boat.ready && boat.connectionState != 'CONNECTED';
      final statusPaint = Paint()..color = isReady ? AppColors.green : AppColors.orange;
      canvas.drawCircle(Offset(10, y), 3.5, statusPaint);

      // Calcul de la position X
      final progress = math.min(1.0, math.max(0.0, boat.currentDisplayDist / targetDistance));
      final x = leftMargin + trackW * progress;

      // Rendu du kayak
      _drawKayak(
        canvas: canvas,
        x: x,
        y: y,
        boat: boat,
        isMe: isMe,
        defaultColor: defaultColors[i % defaultColors.length],
        minXBound: leftMargin,
        maxXBound: w - 6,
      );
    }
  }

  void _drawKayak({
    required Canvas canvas,
    required double x,
    required double y,
    required BoatRenderState boat,
    required bool isMe,
    required Color defaultColor,
    required double minXBound,
    required double maxXBound,
  }) {
    const hullRx = 16.0;
    const hullRy = 4.5;

    final hullColor = isMe ? AppColors.cyan : defaultColor;

    // Sillage d'eau
    final wakePaint = Paint()..color = isMe ? const Color(0x4400F0FF) : const Color(0x2200F0FF);
    canvas.drawOval(
      Rect.fromCenter(center: Offset(x - hullRx - 6, y), width: 22, height: 8),
      wakePaint,
    );

    // Halo lumineux si c'est le joueur connecté
    if (isMe) {
      final glowPaint = Paint()
        ..color = AppColors.cyan.withOpacity(0.4)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.0
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6);
      canvas.drawOval(
        Rect.fromCenter(center: Offset(x, y), width: hullRx * 2 + 6, height: hullRy * 2 + 4),
        glowPaint,
      );
    }

    // Animation des rames
    final spm = boat.spm > 0 ? boat.spm : (boat.currentDisplayDist > 0 ? 26.0 : 0.0);
    final freq = spm > 0 ? spm / 60.0 : 0.0;
    final strokeAngle = freq > 0 ? math.sin(nowSec * freq * math.pi * 2 + boat.lane) * 0.55 : 0.0;

    const oarLen = 8.5;
    final dxOar = math.sin(strokeAngle) * oarLen;
    final dyOar = math.cos(strokeAngle) * oarLen;

    final oarPaint = Paint()
      ..color = isMe ? AppColors.cyan : Colors.white70
      ..strokeWidth = 1.6
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(Offset(x - dxOar, y - dyOar), Offset(x + dxOar, y + dyOar), oarPaint);

    // Coque du kayak
    final hullPaint = Paint()..color = hullColor;
    final borderPaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = isMe ? 1.4 : 1.0;

    final hullRect = Rect.fromCenter(center: Offset(x, y), width: hullRx * 2, height: hullRy * 2);
    canvas.drawOval(hullRect, hullPaint);
    canvas.drawOval(hullRect, borderPaint);

    // Cockpit & Rameur
    final cockpitPaint = Paint()..color = const Color(0xFF060913);
    canvas.drawOval(Rect.fromCenter(center: Offset(x - 1, y), width: 10, height: 4), cockpitPaint);

    final rowerPaint = Paint()..color = isMe ? AppColors.yellow : const Color(0xFFFCD34D);
    canvas.drawCircle(Offset(x - 2, y), 2.5, rowerPaint);

    // Bannière pseudo placée par défaut devant le kayak dans la ligne d'eau (et bascule derrière près de l'arrivée)
    final shortName = boat.name.length > 12 ? '${boat.name.substring(0, 11)}…' : boat.name;
    final bannerText = isMe
        ? '★ VOUS : $shortName · ${boat.currentDisplayDist.round()}m'
        : '$shortName · ${boat.currentDisplayDist.round()}m';

    final textSpan = TextSpan(
      text: bannerText,
      style: TextStyle(
        color: isMe ? AppColors.cyan : Colors.white,
        fontSize: isMe ? 11 : 10,
        fontWeight: isMe ? FontWeight.w900 : FontWeight.w700,
      ),
    );
    final tp = TextPainter(text: textSpan, textDirection: TextDirection.ltr)..layout();

    const gap = 8.0;
    final boxW = tp.width + 8;
    final placeBack = (x + hullRx + gap + boxW > maxXBound) && (x - hullRx - gap - boxW >= minXBound);
    final bx = placeBack
        ? math.max(minXBound + 4, x - hullRx - gap - tp.width - 4)
        : math.min(maxXBound - tp.width - 4, x + hullRx + gap + 4);
    final by = y - tp.height / 2;

    final bgBox = Paint()..color = isMe ? const Color(0xEE060F21) : const Color(0xD6060F21);
    final borderBox = Paint()
      ..color = isMe ? AppColors.cyan : const Color(0x73FFFFFF)
      ..style = PaintingStyle.stroke
      ..strokeWidth = isMe ? 1.2 : 0.9;

    final rect = RRect.fromRectAndRadius(
      Rect.fromLTWH(bx - 4, by - 2, tp.width + 8, tp.height + 4),
      const Radius.circular(4),
    );
    canvas.drawRRect(rect, bgBox);
    canvas.drawRRect(rect, borderBox);

    tp.paint(canvas, Offset(bx, by));
  }

  @override
  bool shouldRepaint(covariant _RegattaCustomPainter oldDelegate) => true;
}
