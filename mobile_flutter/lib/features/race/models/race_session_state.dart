import 'live_racer_metric.dart';
import '../../ble/models/rowing_metrics.dart';

enum RacePhase {
  idle,
  lobbyWaiting,
  countdown15s,
  racing,
  finished,
  abandoned,
  solo;

  // Alias de compatibilité
  static const RacePhase lobby = RacePhase.lobbyWaiting;
  static const RacePhase ready = RacePhase.lobbyWaiting;
  static const RacePhase countdown = RacePhase.countdown15s;
  static const RacePhase completed = RacePhase.finished;
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
  final RowingMetrics myMetrics;

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
    this.myMetrics = const RowingMetrics(),
  });

  // Getters de compatibilité
  bool get isFinished => phase == RacePhase.finished;
  bool get isDnf => isAbandoned || phase == RacePhase.abandoned;
  bool get isRacing => phase == RacePhase.racing || phase == RacePhase.solo;
  bool get isCountingDownWarning => isFalseStartWarningActive;
  bool get isStartBlockedWarning => isFalseStartPenaltyLocked;
  List<LiveRacerMetric> get leaderboard => racers;
  int get elapsedTimeSeconds => 3300 - gameRemainingSeconds;
  double get myDistance => myMetrics.distanceMeters;

  // Gaps calculés
  int get gapAheadSeconds {
    final pace = myMetrics.instantPace > 0 ? myMetrics.instantPace : 120;
    return ((distToPrev / 500.0) * pace).round();
  }

  int get gapBehindSeconds {
    final pace = myMetrics.instantPace > 0 ? myMetrics.instantPace : 120;
    return ((distToNext / 500.0) * pace).round();
  }

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
    RowingMetrics? myMetrics,
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
      myMetrics: myMetrics ?? this.myMetrics,
    );
  }
}
