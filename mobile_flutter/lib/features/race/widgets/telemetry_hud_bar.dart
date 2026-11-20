import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/i18n_service.dart';
import '../../../core/theme/app_theme.dart';
import '../../ble/models/rowing_metrics.dart';
import '../models/race_session_state.dart';

class TelemetryHudBar extends ConsumerWidget {
  final RowingMetrics metrics;
  final RaceSessionState raceState;
  final VoidCallback onToggleCockpit;

  const TelemetryHudBar({
    super.key,
    required this.metrics,
    required this.raceState,
    required this.onToggleCockpit,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isFr = ref.watch(i18nProvider) == 'fr';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: const Border(
          top: BorderSide(color: AppColors.cardBorder, width: 1.2),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.5),
            blurRadius: 10,
            offset: const Offset(0, -3),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            // 1. Puissance Watts
            _buildMetricItem(
              label: isFr ? 'PUISSANCE' : 'POWER',
              value: '${metrics.instantPower}',
              unit: 'W',
              sub: '${isFr ? "Moy" : "Avg"}: ${metrics.avgPower} W',
              valueColor: AppColors.cyan,
            ),
            _buildDivider(),

            // 2. Allure /500m
            _buildMetricItem(
              label: isFr ? 'ALLURE' : 'PACE',
              value: metrics.formattedPace,
              unit: '/500m',
              sub: '${isFr ? "Moy" : "Avg"}: ${metrics.formattedAvgPace}',
              valueColor: Colors.white,
            ),
            _buildDivider(),

            // 3. Cadence SPM
            _buildMetricItem(
              label: isFr ? 'CADENCE' : 'RATE',
              value: metrics.strokeRate.toStringAsFixed(0),
              unit: 'SPM',
              sub: '${metrics.strokeCount} ${isFr ? "coups" : "strk"}',
              valueColor: Colors.white,
            ),
            _buildDivider(),

            // 4. Distance
            _buildMetricItem(
              label: 'DISTANCE',
              value: '${metrics.totalDistance}',
              unit: 'm',
              sub: '${isFr ? "Obj" : "Goal"}: ${raceState.targetDistance}m',
              valueColor: AppColors.yellow,
            ),
            _buildDivider(),

            // 5. Rang en direct
            _buildMetricItem(
              label: isFr ? 'RANG' : 'RANK',
              value: '${raceState.myRank}${isFr ? "e" : ""}',
              unit: '/ ${raceState.totalRacers}',
              sub: raceState.distToLeader > 0 ? '-${raceState.distToLeader}m' : 'Leader',
              valueColor: raceState.myRank == 1 ? AppColors.green : AppColors.yellow,
            ),

            // Bouton bascule vers Vue Cockpit
            IconButton(
              icon: const Icon(Icons.fullscreen, color: AppColors.cyan, size: 28),
              tooltip: isFr ? 'Vue Cockpit Plein Écran' : 'Fullscreen Cockpit View',
              onPressed: onToggleCockpit,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMetricItem({
    required String label,
    required String value,
    required String unit,
    required String sub,
    required Color valueColor,
  }) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: AppColors.textMuted),
        ),
        Row(
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            Text(
              value,
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w900,
                fontFamily: 'monospace',
                color: valueColor,
              ),
            ),
            const SizedBox(width: 3),
            Text(
              unit,
              style: const TextStyle(fontSize: 10, color: AppColors.textMuted, fontWeight: FontWeight.w600),
            ),
          ],
        ),
        Text(
          sub,
          style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
        ),
      ],
    );
  }

  Widget _buildDivider() {
    return Container(
      width: 1,
      height: 32,
      color: AppColors.cardBorder,
    );
  }
}
