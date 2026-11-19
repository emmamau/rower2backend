import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../controllers/race_controller.dart';
import '../models/race_session_state.dart';
import '../widgets/regatta_water_painter.dart';
import '../widgets/telemetry_hud_bar.dart';
import '../widgets/fullscreen_cockpit.dart';
import '../widgets/false_start_overlay.dart';
import '../widgets/podium_finish_modal.dart';

/// Écran principal de la régate en temps réel.
/// Gère le verrouillage plein écran, Wakelock, PopScope DNF,
/// l'affichage du plan d'eau ou du cockpit, et les alertes anti-triche.
class RaceScreen extends ConsumerStatefulWidget {
  final String roomId;
  final double targetDistance;

  const RaceScreen({
    super.key,
    required this.roomId,
    this.targetDistance = 500.0,
  });

  @override
  ConsumerState<RaceScreen> createState() => _RaceScreenState();
}

class _RaceScreenState extends ConsumerState<RaceScreen> {
  bool _isCockpitView = false;
  bool _showPodiumModal = false;

  @override
  void initState() {
    super.initState();
    // Activer Wakelock et mode immersif
    WakelockPlus.enable();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);

    // Initialiser la session de course
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(raceControllerProvider.notifier).startSession(
            roomId: widget.roomId,
            targetDistance: widget.targetDistance,
          );
    });
  }

  @override
  void dispose() {
    WakelockPlus.disable();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  Future<bool> _onWillPop() async {
    final state = ref.read(raceControllerProvider);
    if (state.phase == RacePhase.completed || state.phase == RacePhase.lobby) {
      return true;
    }

    // Demande de confirmation avec avertissement DNF
    final shouldQuit = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E2638),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          'ABANDONNER LA COURSE ?',
          style: TextStyle(
            color: Colors.redAccent,
            fontWeight: FontWeight.w900,
            letterSpacing: 1.0,
          ),
        ),
        content: const Text(
          'Si vous quittez maintenant, la course sera enregistrée en DNF (0 point de ligue). Êtes-vous sûr de vouloir abandonner ?',
          style: TextStyle(color: Colors.white70, fontSize: 14),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('CONTINUER À RAMER', style: TextStyle(color: Colors.white70)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.redAccent,
              foregroundColor: Colors.white,
            ),
            onPressed: () {
              ref.read(raceControllerProvider.notifier).forfeitRace();
              Navigator.of(context).pop(true);
            },
            child: const Text('CONFIRMER ABANDON'),
          ),
        ],
      ),
    );

    return shouldQuit ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final sessionState = ref.watch(raceControllerProvider);

    // Détection de fin de course pour ouvrir automatiquement le podium
    if ((sessionState.isFinished || sessionState.isDnf) && !_showPodiumModal) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        setState(() => _showPodiumModal = true);
      });
    }

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        final allow = await _onWillPop();
        if (allow && context.mounted) {
          Navigator.of(context).pop();
        }
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF0F141E),
        body: Stack(
          children: [
            // Contenu Principal (Plan d'eau ou Cockpit + HUD)
            Column(
              children: [
                // Barre Supérieure (Room, Status, Bascule Cockpit, Quitter)
                _buildTopBar(sessionState),

                // Zone centrale : Eau 2D ou Cockpit
                Expanded(
                  child: _isCockpitView
                      ? FullscreenCockpit(
                          metrics: sessionState.myMetrics,
                          currentDistance: sessionState.myDistance,
                          targetDistance: sessionState.targetDistance,
                          elapsedSeconds: sessionState.elapsedTimeSeconds,
                          myRank: sessionState.myRank,
                          totalRacers: sessionState.totalRacers,
                        )
                      : Container(
                          color: const Color(0xFF0B1422),
                          child: RegattaWaterPainter(
                            racers: sessionState.leaderboard,
                            targetDistance: sessionState.targetDistance,
                            racePhase: sessionState.phase,
                          ),
                        ),
                ),

                // Bandeau HUD Basse Visibilité & Zéro Scroll
                TelemetryHudBar(
                  metrics: sessionState.myMetrics,
                  currentDistance: sessionState.myDistance,
                  targetDistance: sessionState.targetDistance,
                  elapsedSeconds: sessionState.elapsedTimeSeconds,
                  myRank: sessionState.myRank,
                  totalRacers: sessionState.totalRacers,
                  gapAheadSeconds: sessionState.gapAheadSeconds,
                  gapBehindSeconds: sessionState.gapBehindSeconds,
                  onToggleCockpit: () {
                    setState(() {
                      _isCockpitView = !_isCockpitView;
                    });
                  },
                ),
              ],
            ),

            // Alerte Anti-triche (Faux départ / Arrêt complet requis)
            FalseStartOverlay(
              isCountingDownWarning: sessionState.isCountingDownWarning,
              isStartBlockedWarning: sessionState.isStartBlockedWarning,
              countdownSeconds: sessionState.countdownSeconds,
            ),

            // Modal Podium & Statistiques finales
            if (_showPodiumModal)
              PodiumFinishModal(
                sessionState: sessionState,
                onQuit: () {
                  ref.read(raceControllerProvider.notifier).reset();
                  Navigator.of(context).pop();
                },
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildTopBar(RaceSessionState state) {
    String statusLabel = 'ATTENTE JOUEURS';
    Color statusColor = Colors.orangeAccent;

    switch (state.phase) {
      case RacePhase.lobby:
        statusLabel = 'EN ATTENTE D\'UN COUP DE RAME';
        statusColor = Colors.orangeAccent;
        break;
      case RacePhase.ready:
        statusLabel = 'PRÊT (READY)';
        statusColor = Colors.greenAccent;
        break;
      case RacePhase.countdown:
        statusLabel = 'DÉPART DANS ${state.countdownSeconds}s';
        statusColor = Colors.redAccent;
        break;
      case RacePhase.racing:
        statusLabel = 'EN COURSE';
        statusColor = Colors.cyanAccent;
        break;
      case RacePhase.completed:
        statusLabel = 'TERMINÉ';
        statusColor = Colors.amberAccent;
        break;
    }

    return Container(
      color: const Color(0xFF141A28),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: SafeArea(
        bottom: false,
        child: Row(
          children: [
            // Bouton Quitter
            IconButton(
              icon: const Icon(Icons.close, color: Colors.white70),
              tooltip: 'Quitter la course',
              onPressed: () async {
                final allow = await _onWillPop();
                if (allow && mounted) {
                  Navigator.of(context).pop();
                }
              },
            ),
            const SizedBox(width: 8),

            // Titre & Info Salon
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      Text(
                        'SALON #${widget.roomId}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                          fontSize: 14,
                          letterSpacing: 1.0,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: statusColor.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(color: statusColor, width: 0.8),
                        ),
                        child: Text(
                          statusLabel,
                          style: TextStyle(
                            color: statusColor,
                            fontWeight: FontWeight.w800,
                            fontSize: 10,
                          ),
                        ),
                      ),
                    ],
                  ),
                  Text(
                    'OBJECTIF : ${widget.targetDistance.toStringAsFixed(0)}m',
                    style: const TextStyle(
                      color: Colors.white54,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),

            // Bascule Vue Cockpit / Régate
            IconButton(
              icon: Icon(
                _isCockpitView ? Icons.water_outlined : Icons.speed,
                color: Colors.cyanAccent,
              ),
              tooltip: _isCockpitView ? 'Vue Régate' : 'Vue Cockpit',
              onPressed: () {
                setState(() {
                  _isCockpitView = !_isCockpitView;
                });
              },
            ),
          ],
        ),
      ),
    );
  }
}
