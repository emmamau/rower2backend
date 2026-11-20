class LiveRacerMetric {
  final int lane;
  final String userId;
  final String name;
  final int dist;
  final int split;
  final int watts;
  final double spm;
  final int? heartRate;
  final String? country;
  final String status;
  final int? elapsedTime;
  final bool ready;
  final String connectionState; // 'CONNECTED' | 'READY'
  final bool isBot;
  final bool isPaired;
  final Map<String, dynamic>? kayak;

  const LiveRacerMetric({
    required this.lane,
    required this.userId,
    required this.name,
    required this.dist,
    required this.split,
    required this.watts,
    required this.spm,
    this.heartRate,
    this.country,
    required this.status,
    this.elapsedTime,
    this.ready = true,
    this.connectionState = 'READY',
    this.isBot = false,
    this.isPaired = false,
    this.kayak,
  });

  // Getters de compatibilité
  bool get isFinished => status == 'completed' || status == 'finished';
  int get distance => dist;
  String get displayName => name;
  bool get isMe => isPaired;
  int? get finishTimeSeconds => elapsedTime;

  factory LiveRacerMetric.fromMap(Map<String, dynamic> map) {
    return LiveRacerMetric(
      lane: map['lane'] is num ? (map['lane'] as num).toInt() : 1,
      userId: map['userId']?.toString() ?? '',
      name: map['name']?.toString() ?? '',
      dist: map['dist'] is num ? (map['dist'] as num).toInt() : 0,
      split: map['split'] is num ? (map['split'] as num).toInt() : 120,
      watts: map['watts'] is num ? (map['watts'] as num).toInt() : 0,
      spm: map['spm'] is num ? (map['spm'] as num).toDouble() : 0.0,
      heartRate: map['heartRate'] is num ? (map['heartRate'] as num).toInt() : null,
      country: map['country']?.toString(),
      status: map['status']?.toString() ?? 'waiting',
      elapsedTime: map['elapsedTime'] is num ? (map['elapsedTime'] as num).toInt() : null,
      ready: map['ready'] != false && map['connectionState'] != 'CONNECTED',
      connectionState: map['connectionState']?.toString() ?? (map['ready'] == false ? 'CONNECTED' : 'READY'),
      isBot: map['isBot'] == true,
      isPaired: map['isPaired'] == true,
      kayak: map['kayak'] is Map ? Map<String, dynamic>.from(map['kayak'] as Map) : null,
    );
  }
}

/// État interpolé pour le moteur de rendu 60 FPS CustomPainter
class BoatRenderState {
  final String userId;
  String name;
  int lane;
  int assignedLane;
  int dynamicLaneIndex;
  double currentLaneIndex;
  double currentDisplayDist;
  double targetPacketDist;
  int splitSec;
  int watts;
  double spm;
  String status;
  bool ready;
  String connectionState;
  bool isBot;
  bool isPaired;
  Map<String, dynamic>? kayak;

  BoatRenderState({
    required this.userId,
    required this.name,
    required this.lane,
    required this.assignedLane,
    required this.dynamicLaneIndex,
    required this.currentLaneIndex,
    required this.currentDisplayDist,
    required this.targetPacketDist,
    required this.splitSec,
    required this.watts,
    required this.spm,
    required this.status,
    required this.ready,
    required this.connectionState,
    this.isBot = false,
    this.isPaired = false,
    this.kayak,
  });
}
