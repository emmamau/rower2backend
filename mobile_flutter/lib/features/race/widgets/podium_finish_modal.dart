import 'package:flutter/material.dart';
import '../models/race_session_state.dart';
import '../models/live_racer_metric.dart';

/// Modal de fin de course avec podium, statistiques sécurisées (aucun NaN)
/// et gain de points de ligue (+XX pts).
class PodiumFinishModal extends StatelessWidget {
  final RaceSessionState sessionState;
  final VoidCallback onQuit;

  const PodiumFinishModal({
    super.key,
    required this.sessionState,
    required this.onQuit,
  });

  String _formatDuration(int seconds) {
    if (seconds <= 0) return '--:--';
    final m = seconds ~/ 60;
    final s = seconds % 60;
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }

  String _formatPace(int paceSeconds) {
    if (paceSeconds <= 0 || paceSeconds >= 3600) return '--:--';
    final m = paceSeconds ~/ 60;
    final s = paceSeconds % 60;
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}/500m';
  }

  @override
  Widget build(BuildContext context) {
    final racers = List<LiveRacerMetric>.from(sessionState.leaderboard);
    // Trier par rang croissant ou distance décroissante
    racers.sort((a, b) {
      if (a.isFinished && !b.isFinished) return -1;
      if (!a.isFinished && b.isFinished) return 1;
      return b.distance.compareTo(a.distance);
    });

    final myRank = sessionState.myRank;
    final totalRacers = sessionState.totalRacers;
    final isDnf = sessionState.isDnf;

    // Calcul des points gagnés (basé sur le rang et finish)
    int pointsEarned = 0;
    if (!isDnf && sessionState.isFinished) {
      if (myRank == 1) {
        pointsEarned = 50;
      } else if (myRank == 2) {
        pointsEarned = 35;
      } else if (myRank == 3) {
        pointsEarned = 25;
      } else {
        pointsEarned = 10;
      }
    }

    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      child: Container(
        constraints: const BoxConstraints(maxWidth: 500),
        decoration: BoxDecoration(
          color: const Color(0xFF1E2638),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: Colors.cyanAccent.withOpacity(0.4), width: 1.5),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.6),
              blurRadius: 25,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Titre & Badge
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  isDnf ? Icons.flag_outlined : Icons.emoji_events,
                  color: isDnf ? Colors.redAccent : Colors.amberAccent,
                  size: 32,
                ),
                const SizedBox(width: 10),
                Text(
                  isDnf ? 'COURSE ABANDONNÉE (DNF)' : 'COURSE TERMINÉE',
                  style: TextStyle(
                    color: isDnf ? Colors.redAccent : Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.2,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // Podium Top 3 (ou liste compacte)
            if (racers.isNotEmpty) ...[
              const Text(
                'CLASSEMENT FINAL',
                style: TextStyle(
                  color: Colors.white54,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.5,
                ),
              ),
              const SizedBox(height: 10),
              Container(
                constraints: const BoxConstraints(maxHeight: 180),
                decoration: BoxDecoration(
                  color: const Color(0xFF141A28),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.white10),
                ),
                child: ListView.separated(
                  shrinkWrap: true,
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  itemCount: racers.length > 5 ? 5 : racers.length,
                  separatorBuilder: (_, __) => const Divider(color: Colors.white10, height: 1),
                  itemBuilder: (context, index) {
                    final r = racers[index];
                    final rank = index + 1;
                    final isMe = r.isMe;

                    Color rankColor = Colors.white70;
                    if (rank == 1) rankColor = Colors.amber;
                    if (rank == 2) rankColor = const Color(0xFFC0C0C0);
                    if (rank == 3) rankColor = const Color(0xFFCD7F32);

                    return Container(
                      color: isMe ? Colors.cyanAccent.withOpacity(0.08) : Colors.transparent,
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      child: Row(
                        children: [
                          Container(
                            width: 26,
                            alignment: Alignment.center,
                            child: Text(
                              '$rank',
                              style: TextStyle(
                                color: rankColor,
                                fontWeight: FontWeight.w900,
                                fontSize: 16,
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              r.displayName,
                              style: TextStyle(
                                color: isMe ? Colors.cyanAccent : Colors.white,
                                fontWeight: isMe ? FontWeight.w900 : FontWeight.w600,
                                fontSize: 14,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          Text(
                            r.isFinished ? _formatDuration(r.finishTimeSeconds ?? 0) : '${r.distance.toStringAsFixed(0)}m',
                            style: TextStyle(
                              color: r.isFinished ? Colors.white : Colors.white54,
                              fontFamily: 'monospace',
                              fontWeight: FontWeight.w700,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: 16),
            ],

            // Bilan Joueur Local
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF141A28),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.white10),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _MetricStat(
                    label: 'RANG',
                    value: isDnf ? 'DNF' : (totalRacers > 0 ? '$myRank / $totalRacers' : '$myRank'),
                    color: isDnf ? Colors.redAccent : Colors.cyanAccent,
                  ),
                  _MetricStat(
                    label: 'CHRONO',
                    value: _formatDuration(sessionState.elapsedTimeSeconds),
                    color: Colors.white,
                  ),
                  _MetricStat(
                    label: 'POINTS',
                    value: '+$pointsEarned pts',
                    color: Colors.amberAccent,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Bouton Quitter / Retour Salon
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: onQuit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.cyanAccent,
                  foregroundColor: Colors.black,
                  elevation: 4,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: const Text(
                  'RETOURNER À L\'ACCUEIL',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.0,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MetricStat extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _MetricStat({
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          label,
          style: const TextStyle(
            color: Colors.white54,
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.0,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: TextStyle(
            color: color,
            fontSize: 17,
            fontWeight: FontWeight.w900,
            fontFamily: 'monospace',
          ),
        ),
      ],
    );
  }
}
