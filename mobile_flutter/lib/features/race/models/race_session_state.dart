import 'live_racer_metric.dart';

enum RacePhase {
  idle,
  lobbyWaiting,
  countdown15s,
  racing,
  finished,
  abandoned,
  solo,
}

class RaceSessionState {
  final RacePhase phase;
  final String raceId;
  final String title;
  final int targetDistance;
  final int myAssignedLane;
  final int countdownSeconds;
  final int gameRemainingSeconds;
  final String waitingStatusMessage;
  final bool isPrivateSalon;
  final String gameMode; // 'multi' | 'solo' | 'bot_duel' | 'duel_1v1'
  final bool isBleRowerReady;
  final bool isFalseStartWarningActive; // Alerte rouge clignotante pendant cd <= 15s
  final bool isFalseStartPenaltyLocked; // Bloqué à 0m au départ T=0 tant que pas arrêté
  final int myRank;
  final int totalRacers;
  final int distToLeader;
  final int distToPrev;
  final int distToNext;
  final List<LiveRacerMetric> racers;
  final List<Map<String, dynamic>> podiumTop3;
  final int pointsEarned;
  final bool isAbandoned;

  const RaceSessionState({
    this.phase = RacePhase.idle,
    this.raceId = '',
    this.title = 'Régate RowerRace',
    this.targetDistance = 2000,
    this.myAssignedLane = 1,
    this.countdownSeconds = 0,
    this.gameRemainingSeconds = 3300,
    this.waitingStatusMessage = 'En attente des rameurs...',
    this.isPrivateSalon = false,
    this.gameMode = 'multi',
    this.isBleRowerReady = false,
    this.isFalseStartWarningActive = false,
    this.isFalseStartPenaltyLocked = false,
    this.myRank = 1,
    this.totalRacers = 1,
    this.distToLeader = 0,
    this.distToPrev = 0,
    this.distToNext = 0,
    this.racers = const [],
    this.podiumTop3 = const [],
    this.pointsEarned = 0,
    this.isAbandoned = false,
  });

  RaceSessionState copyWith({
    RacePhase? phase,
    String? raceId,
    String? title,
    int? targetDistance,
    int? myAssignedLane,
    int? countdownSeconds,
    int? gameRemainingSeconds,
    String? waitingStatusMessage,
    bool? isPrivateSalon,
    String? gameMode,
    bool? isBleRowerReady,
    bool? isFalseStartWarningActive,
    bool? isFalseStartPenaltyLocked,
    int? myRank,
    int? totalRacers,
    int? distToLeader,
    int? distToPrev,
    int? distToNext,
    List<LiveRacerMetric>? racers,
    List<Map<String, dynamic>>? podiumTop3,
    int? pointsEarned,
    bool? isAbandoned,
  }) {
    return RaceSessionState(
      phase: phase ?? this.phase,
      raceId: raceId ?? this.raceId,
      title: title ?? this.title,
      targetDistance: targetDistance ?? this.targetDistance,
      myAssignedLane: myAssignedLane ?? this.myAssignedLane,
      countdownSeconds: countdownSeconds ?? this.countdownSeconds,
      gameRemainingSeconds: gameRemainingSeconds ?? this.gameRemainingSeconds,
      waitingStatusMessage: waitingStatusMessage ?? this.waitingStatusMessage,
      isPrivateSalon: isPrivateSalon ?? this.isPrivateSalon,
      gameMode: gameMode ?? this.gameMode,
      isBleRowerReady: isBleRowerReady ?? this.isBleRowerReady,
      isFalseStartWarningActive: isFalseStartWarningActive ?? this.isFalseStartWarningActive,
      isFalseStartPenaltyLocked: isFalseStartPenaltyLocked ?? this.isFalseStartPenaltyLocked,
      myRank: myRank ?? this.myRank,
      totalRacers: totalRacers ?? this.totalRacers,
      distToLeader: distToLeader ?? this.distToLeader,
      distToPrev: distToPrev ?? this.distToPrev,
      distToNext: distToNext ?? this.distToNext,
      racers: racers ?? this.racers,
      podiumTop3: podiumTop3 ?? this.podiumTop3,
      pointsEarned: pointsEarned ?? this.pointsEarned,
      isAbandoned: isAbandoned ?? this.isAbandoned,
    );
  }
}
