import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import '../../ble/models/rowing_metrics.dart';
import '../models/race_session_state.dart';

class FullscreenCockpitView extends StatelessWidget {
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
  Widget build(BuildContext context) {
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
                        raceState.isPrivateSalon ? 'SALON PRIVÉ' : 'RÉGATE OFFICIELLE',
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
                      'Ligne ${raceState.myAssignedLane}',
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
                  label: const Text('Plan d’eau 2D', style: TextStyle(fontSize: 12)),
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
                        label: 'PUISSANCE INSTANTANÉE',
                        value: '${metrics.instantPower}',
                        unit: 'WATTS',
                        sub: 'Moyenne : ${metrics.avgPower} W',
                        color: AppColors.cyan,
                      ),

                      // 2. Allure /500m
                      _buildBigMeter(
                        label: 'ALLURE MOYENNE / 500M',
                        value: metrics.formattedPace,
                        unit: '/500M',
                        sub: 'Moyenne : ${metrics.formattedAvgPace}',
                        color: Colors.white,
                      ),

                      // 3. Cadence Strokes Per Minute
                      _buildBigMeter(
                        label: 'CADENCE',
                        value: metrics.strokeRate.toStringAsFixed(0),
                        unit: 'SPM',
                        sub: 'Total : ${metrics.strokeCount} coups',
                        color: Colors.white,
                      ),

                      // 4. Distance
                      _buildBigMeter(
                        label: 'DISTANCE PARCOURUE',
                        value: '${metrics.totalDistance}',
                        unit: 'MÈTRES',
                        sub: 'Objectif : ${raceState.targetDistance} m',
                        color: AppColors.yellow,
                      ),

                      // 5. Rang en direct
                      _buildBigMeter(
                        label: 'CLASSEMENT EN DIRECT',
                        value: '#${raceState.myRank}',
                        unit: '/ ${raceState.totalRacers}',
                        sub: raceState.distToLeader > 0 ? '-${raceState.distToLeader}m du 1er' : 'En tête de course',
                        color: raceState.myRank == 1 ? AppColors.green : AppColors.yellow,
                      ),

                      // 6. Chronomètre
                      _buildBigMeter(
                        label: 'CHRONO DE COURSE',
                        value: _formatChrono(metrics.elapsedTime),
                        unit: 'TEMPS',
                        sub: 'Restant max : ${(raceState.gameRemainingSeconds ~/ 60)} min',
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
