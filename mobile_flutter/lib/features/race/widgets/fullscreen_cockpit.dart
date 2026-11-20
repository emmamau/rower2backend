import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/i18n_service.dart';
import '../../../core/theme/app_theme.dart';
import '../../ble/models/rowing_metrics.dart';
import '../models/race_session_state.dart';

class FullscreenCockpitView extends ConsumerWidget {
  final RowingMetrics metrics;
  final RaceSessionState raceState;
  final VoidCallback onToggleRegatta;

  const FullscreenCockpitView({
    super.key,
    required this.metrics,
    required this.raceState,
    required this.onToggleRegatta,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isFr = ref.watch(i18nProvider) == 'fr';

    return Container(
      color: AppColors.background,
      padding: const EdgeInsets.all(16),
      child: SafeArea(
        child: Column(
          children: [
            // Barre supérieure avec titre et rang
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceLight,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppColors.cyan.withOpacity(0.5)),
                      ),
                      child: Text(
                        raceState.isPrivateSalon
                            ? (isFr ? 'SALON PRIVÉ' : 'PRIVATE ROOM')
                            : (isFr ? 'RÉGATE OFFICIELLE' : 'OFFICIAL REGATTA'),
                        style: const TextStyle(
                          color: AppColors.cyan,
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.8,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      '${isFr ? "Ligne" : "Lane"} ${raceState.myAssignedLane}',
                      style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.textMuted),
                    ),
                  ],
                ),
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.surfaceLight,
                    foregroundColor: AppColors.cyan,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  ),
                  icon: const Icon(Icons.waves, size: 18),
                  label: Text(isFr ? 'Plan d’eau 2D' : '2D Course', style: const TextStyle(fontSize: 12)),
                  onPressed: onToggleRegatta,
                ),
              ],
            ),
            const SizedBox(height: 16),

            // Grille 2x3 ou 3x2 de compteurs géants haute visibilité
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final isLandscape = constraints.maxWidth > constraints.maxHeight;

                  return GridView.count(
                    crossAxisCount: isLandscape ? 3 : 2,
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 12,
                    childAspectRatio: isLandscape ? 1.6 : 1.25,
                    physics: const NeverScrollableScrollPhysics(),
                    children: [
                      // 1. Puissance Watts
                      _buildBigMeter(
                        label: isFr ? 'PUISSANCE INSTANTANÉE' : 'INSTANT POWER',
                        value: '${metrics.instantPower}',
                        unit: 'WATTS',
                        sub: '${isFr ? "Moyenne" : "Average"} : ${metrics.avgPower} W',
                        color: AppColors.cyan,
                      ),

                      // 2. Allure /500m
                      _buildBigMeter(
                        label: isFr ? 'ALLURE MOYENNE / 500M' : 'AVG PACE / 500M',
                        value: metrics.formattedPace,
                        unit: '/500M',
                        sub: '${isFr ? "Moyenne" : "Average"} : ${metrics.formattedAvgPace}',
                        color: Colors.white,
                      ),

                      // 3. Cadence Strokes Per Minute
                      _buildBigMeter(
                        label: isFr ? 'CADENCE' : 'RATE',
                        value: metrics.strokeRate.toStringAsFixed(0),
                        unit: 'SPM',
                        sub: 'Total : ${metrics.strokeCount} ${isFr ? "coups" : "strk"}',
                        color: Colors.white,
                      ),

                      // 4. Distance
                      _buildBigMeter(
                        label: isFr ? 'DISTANCE PARCOURUE' : 'DISTANCE COVERED',
                        value: '${metrics.totalDistance}',
                        unit: isFr ? 'MÈTRES' : 'METERS',
                        sub: '${isFr ? "Objectif" : "Goal"} : ${raceState.targetDistance} m',
                        color: AppColors.yellow,
                      ),

                      // 5. Rang en direct
                      _buildBigMeter(
                        label: isFr ? 'CLASSEMENT EN DIRECT' : 'LIVE RANKING',
                        value: '#${raceState.myRank}',
                        unit: '/ ${raceState.totalRacers}',
                        sub: raceState.distToLeader > 0
                            ? (isFr ? '-${raceState.distToLeader}m du 1er' : '-${raceState.distToLeader}m from leader')
                            : (isFr ? 'En tête de course' : 'Leading race'),
                        color: raceState.myRank == 1 ? AppColors.green : AppColors.yellow,
                      ),

                      // 6. Chronomètre
                      _buildBigMeter(
                        label: isFr ? 'CHRONO DE COURSE' : 'RACE CHRONO',
                        value: _formatChrono(metrics.elapsedTime),
                        unit: isFr ? 'TEMPS' : 'TIME',
                        sub: isFr
                            ? 'Restant max : ${(raceState.gameRemainingSeconds ~/ 60)} min'
                            : 'Max remaining : ${(raceState.gameRemainingSeconds ~/ 60)} min',
                        color: AppColors.cyan,
                      ),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBigMeter({
    required String label,
    required String value,
    required String unit,
    required String sub,
    required Color color,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.cardBorder, width: 1.2),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1800F0FF),
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w800,
              color: AppColors.textMuted,
              letterSpacing: 0.6,
            ),
          ),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 48,
                    fontWeight: FontWeight.w900,
                    fontFamily: 'monospace',
                    color: color,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  unit,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
          Text(
            sub,
            style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }

  String _formatChrono(int sec) {
    final m = sec ~/ 60;
    final s = sec % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }
}
