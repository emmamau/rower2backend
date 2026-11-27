import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/realtime_socket_service.dart';
import '../../../core/storage/secure_storage_service.dart';
import '../../auth/controllers/auth_controller.dart';
import '../../ble/models/rowing_metrics.dart';
import '../../ble/services/ble_ftms_service.dart';
import '../models/live_racer_metric.dart';
import '../models/race_session_state.dart';

final raceControllerProvider = StateNotifierProvider<RaceController, RaceSessionState>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  final socketService = ref.watch(realtimeSocketServiceProvider);
  final bleService = ref.watch(bleFtmsServiceProvider);
  final storage = ref.watch(secureStorageServiceProvider);

  final controller = RaceController(
    apiClient,
    socketService,
    bleService,
    storage,
    ref.read(authControllerProvider).value?.displayPseudo ?? 'Rameur_Mobile',
  );

  // Ne recree plus le controleur (et son etat) a chaque changement d'auth
  ref.listen(authControllerProvider, (_, next) {
    final pseudo = next.value?.displayPseudo;
    if (pseudo != null) controller.updateUserDisplayName(pseudo);
  });

  ref.onDispose(() => controller.dispose());
  return controller;
});

class RaceController extends StateNotifier<RaceSessionState> {
  final ApiClient _apiClient;
  final RealtimeSocketService _socketService;
  final BleFtmsService _bleService;
  final SecureStorageService _storage;
  String _userDisplayName;

  StreamSubscription? _bleMetricsSub;
  StreamSubscription? _socketLeaderboardSub;
  StreamSubscription? _socketStatusSub;
  StreamSubscription? _socketPrivateSub;

  Timer? _oneSecondTimer;
  int _lastSentDistance = -1;
  int _lastSentStrokeCount = -1;
  bool _isSendingBoost = false;
  int _sessionChronometerSec = 0;

  RaceController(
    this._apiClient,
    this._socketService,
    this._bleService,
    this._storage,
    this._userDisplayName,
  ) : super(RaceSessionState(myMetrics: _bleService.currentMetrics)) {
    _initSubscriptions();
  }

  void updateUserDisplayName(String name) {
    _userDisplayName = name;
  }

  void _initSubscriptions() {
    // 1. Écoute continue de la télémétrie du rameur BLE
    _bleMetricsSub = _bleService.metricsStream.listen(_onBleMetricsReceived);

    // 2. Écoute du flux WebSocket de leaderboard
    _socketLeaderboardSub = _socketService.leaderboardStream.listen(_onLeaderboardReceived);

    // 3. Écoute des changements de statut de course
    _socketStatusSub = _socketService.statusChangeStream.listen(_onStatusChangeReceived);

    // 4. Écoute des mises à jour des salons privés
    _socketPrivateSub = _socketService.privateUpdateStream.listen(_onPrivateUpdateReceived);

    // 5. Cadenceur régulier 1 Hz
    _oneSecondTimer = Timer.periodic(const Duration(seconds: 1), (_) => _onOneSecondTick());
  }

  // ==========================================
  // ACTIONS D'ENTRÉE EN COURSE
  // ==========================================

  /// Rejoint la course publique
  Future<void> joinPublicRace({String action = 'join'}) async {
    final deviceId = await _storage.getOrCreateDeviceId();
    final deviceToken = await _storage.getDeviceToken();
    final userId = (await _storage.getUserId()) ?? 'usr_mobile_${deviceId.substring(0, 6)}';

    final res = await _apiClient.joinPublicRace(
      userId: userId,
      userName: _userDisplayName,
      deviceId: deviceId,
      deviceToken: deviceToken,
      action: action,
    );

    if (res.statusCode == 200 && res.data is Map) {
      final data = Map<String, dynamic>.from(res.data as Map);
      final raceId = data['raceId']?.toString() ?? data['id']?.toString() ?? '';
      final lane = data['lane'] is num ? (data['lane'] as num).toInt() : 1;
      final cd = data['secondsRemaining'] is num ? (data['secondsRemaining'] as num).toInt() : 0;
      final target = data['race']?['targetDistance'] is num
          ? (data['race']['targetDistance'] as num).toInt()
          : 2000;

      state = state.copyWith(
        phase: cd > 0 && cd <= 15 ? RacePhase.countdown15s : RacePhase.lobbyWaiting,
        raceId: raceId,
        myAssignedLane: lane,
        countdownSeconds: cd,
        targetDistance: target,
        isPrivateSalon: false,
        gameMode: 'multi',
        isBleRowerReady: false,
      );

      _socketService.connect(userId: userId);
      _socketService.joinRace(raceId);
    }
  }

  /// Initialise l'état à partir d'un salon privé validé (ex: retour de ClaimCodeModal)
  void setupFromPrivateRoom(Map<String, dynamic> data) {
    final raceId = data['raceId']?.toString() ?? data['id']?.toString() ?? data['roomId']?.toString() ?? '';
    final lane = data['lane'] is num ? (data['lane'] as num).toInt() : 1;
    final cd = data['countdownSeconds'] is num
        ? (data['countdownSeconds'] as num).toInt()
        : (data['secondsRemaining'] is num ? (data['secondsRemaining'] as num).toInt() : 0);
    final target = data['targetDistance'] is num ? (data['targetDistance'] as num).toInt() : 2000;
    final mode = data['gameMode']?.toString() ?? 'multi';
    final waitMsg = data['waitingStatusMessage']?.toString() ?? 'Ligne $lane attribuée - Donnez un coup de rame';

    state = state.copyWith(
      phase: cd > 0 && cd <= 15 ? RacePhase.countdown15s : RacePhase.lobbyWaiting,
      raceId: raceId,
      myAssignedLane: lane,
      countdownSeconds: cd,
      targetDistance: target,
      isPrivateSalon: true,
      gameMode: mode,
      waitingStatusMessage: waitMsg,
      isBleRowerReady: false,
    );

    _socketService.connect(userId: data['userId']?.toString());
    _socketService.joinRace(raceId);
  }

  /// Démarre une session d'entraînement libre / solo
  void startSoloSession({int targetDistance = 2000}) {
    _bleService.reTareToZero();
    _sessionChronometerSec = 0;
    state = state.copyWith(
      phase: RacePhase.solo,
      raceId: 'solo_${DateTime.now().millisecondsSinceEpoch}',
      title: 'Cockpit / Entraînement Libre',
      targetDistance: targetDistance,
      myAssignedLane: 1,
      gameMode: 'solo',
      isPrivateSalon: false,
      isBleRowerReady: true,
      myRank: 1,
      totalRacers: 1,
    );
  }

  // ==========================================
  // MACHINE À ÉTATS BLE & ANTI-TRICHE
  // ==========================================

  void startSession({required String roomId, double targetDistance = 2000.0}) {
    if (roomId.contains('solo')) {
      startSoloSession(targetDistance: targetDistance.toInt());
    } else {
      joinPublicRace();
    }
  }

  void forfeitRace() {
    abandonRace();
  }

  void reset() {
    state = const RaceSessionState();
  }

  void _onBleMetricsReceived(RowingMetrics metrics) {
    state = state.copyWith(myMetrics: metrics);
    final isRowingAwake = metrics.instantPower > 0 || metrics.strokeRate > 0.0 || metrics.isMoving;

    // 1. Passage automatique CONNECTED -> READY au premier coup de rame
    if (isRowingAwake && !state.isBleRowerReady && state.raceId.isNotEmpty && state.isPrivateSalon) {
      state = state.copyWith(
        isBleRowerReady: true,
        waitingStatusMessage: 'Rameur prêt - En attente du départ',
      );
      _notifyServerRowerReady(true);
    }

    // 2. Anti-Triche pendant les 15 secondes précédant le départ (0 < T <= 15s)
    if (state.phase == RacePhase.countdown15s && state.countdownSeconds > 0 && state.countdownSeconds <= 15) {
      if (isRowingAwake) {
        state = state.copyWith(isFalseStartWarningActive: true);
        HapticFeedback.heavyImpact();
      } else {
        if (state.isFalseStartWarningActive) {
          state = state.copyWith(isFalseStartWarningActive: false);
        }
      }
      _bleService.reTareToZero(); // Force la distance à rester à 0 m
      return;
    }

    // 3. Anti-Triche au signal de départ (T = 0s)
    if (state.isFalseStartPenaltyLocked) {
      // Bloqué tant que le rameur n'est pas revenu à 0 W et 0 SPM
      final isCompletelyStopped = metrics.instantPower == 0 && metrics.strokeRate == 0.0;
      if (isCompletelyStopped) {
        state = state.copyWith(isFalseStartPenaltyLocked: false);
        _bleService.reTareToZero();
        HapticFeedback.vibrate();
      } else {
        _bleService.reTareToZero(); // Bloque l'avancement de distance à 0 m
        HapticFeedback.heavyImpact();
        return;
      }
    }

    // 4. Session de course active : émission de télémétrie coup par coup vers /boost
    if (state.phase == RacePhase.racing || state.phase == RacePhase.solo) {
      _checkDistanceProgressAndSync(metrics);
    }
  }

  /// Notifie le serveur du passage à READY (POST /api/rooms/:roomId/status)
  Future<void> _notifyServerRowerReady(bool ready) async {
    try {
      final userId = (await _storage.getUserId()) ?? _userDisplayName;
      final devToken = await _storage.getDeviceToken();
      await _apiClient.updateRoomReadyStatus(
        roomId: state.raceId,
        ready: ready,
        userId: userId,
        deviceToken: devToken,
      );
    } catch (_) {}
  }

  /// Tick 1 Hz pour la gestion des comptes à rebours et l'anti-triche T=0
  void _onOneSecondTick() {
    if (state.phase == RacePhase.lobbyWaiting || state.phase == RacePhase.countdown15s) {
      if (state.countdownSeconds > 0) {
        final newCd = state.countdownSeconds - 1;
        if (newCd <= 15 && state.phase != RacePhase.countdown15s) {
          state = state.copyWith(
            phase: RacePhase.countdown15s,
            countdownSeconds: newCd,
          );
        } else if (newCd == 0) {
          // Signal de départ T=0 !
          final m = _bleService.currentMetrics;
          final isStillMoving = m.instantPower > 0 || m.strokeRate > 0.0 || m.isMoving;

          if (isStillMoving) {
            // Faux départ détecté : la course part, mais le joueur est pénalisé à 0m
            state = state.copyWith(
              phase: RacePhase.racing,
              countdownSeconds: 0,
              isFalseStartPenaltyLocked: true,
              isFalseStartWarningActive: false,
            );
            _bleService.reTareToZero();
            HapticFeedback.heavyImpact();
          } else {
            // Départ arrêté parfait !
            state = state.copyWith(
              phase: RacePhase.racing,
              countdownSeconds: 0,
              isFalseStartPenaltyLocked: false,
              isFalseStartWarningActive: false,
            );
            _bleService.reTareToZero();
            HapticFeedback.vibrate();
          }
          _sessionChronometerSec = 0;
        } else {
          state = state.copyWith(countdownSeconds: newCd);
        }
      }
    } else if (state.phase == RacePhase.racing || state.phase == RacePhase.solo) {
      _sessionChronometerSec++;
      if (state.gameRemainingSeconds > 0) {
        state = state.copyWith(gameRemainingSeconds: state.gameRemainingSeconds - 1);
      }
    }
  }

  /// Synchronisation coup par coup vers /boost
  Future<void> _checkDistanceProgressAndSync(RowingMetrics m) async {
    final dist = m.totalDistance;
    final strokes = m.strokeCount;

    // Détection de l'arrivée officielle
    if (state.targetDistance > 0 && dist >= state.targetDistance && state.phase == RacePhase.racing) {
      _finishRace(m);
      return;
    }

    final hasProgressed = dist != _lastSentDistance || strokes != _lastSentStrokeCount;
    if (!hasProgressed || _isSendingBoost) return;

    _lastSentDistance = dist;
    _lastSentStrokeCount = strokes;
    _isSendingBoost = true;

    try {
      final userId = (await _storage.getUserId()) ?? _userDisplayName;
      final devToken = await _storage.getDeviceToken();
      final deviceId = await _storage.getOrCreateDeviceId();

      final payload = {
        'raceId': state.raceId,
        'userId': userId,
        'userName': _userDisplayName,
        'raceMode': state.gameMode == 'solo' ? 'solo' : 'race',
        'status': 'in_progress',
        'targetDistance': state.targetDistance,
        'seq': strokes,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
        'elapsedTime': _sessionChronometerSec,
        'currentDistance': dist,
        'instantPower': m.instantPower,
        'instantPace': m.instantPace,
        'strokeRate': m.strokeRate,
        'spm': m.strokeRate,
        'deviceToken': devToken,
        'deviceId': deviceId,
        'deviceName': _bleService.deviceName ?? 'Rameur BLE',
        'rowerModel': _bleService.deviceName ?? 'Rameur BLE',
        'watchModel': 'RowerRace Mobile (Flutter)',
        'metrics': {
          'distanceM': dist,
          'splitSec': m.instantPace,
          'powerWatts': m.instantPower,
          'strokeRate': m.strokeRate,
          'spm': m.strokeRate,
          'heartRate': m.heartRate,
        },
      };

      final res = await _apiClient.sendBoostTelemetry(payload);
      if (res.statusCode == 200 && res.data is Map) {
        final d = Map<String, dynamic>.from(res.data as Map);
        _updateLiveRankFromBoost(d);
      }
    } catch (_) {
    } finally {
      _isSendingBoost = false;
    }
  }

  void _updateLiveRankFromBoost(Map<String, dynamic> data) {
    final rk = data['rk'] is num
        ? (data['rk'] as num).toInt()
        : (data['rank'] is num ? (data['rank'] as num).toInt() : state.myRank);
    final tot = data['tot'] is num
        ? (data['tot'] as num).toInt()
        : (data['totalRacers'] is num ? (data['totalRacers'] as num).toInt() : state.totalRacers);
    final dLead = data['distToLeader'] is num
        ? (data['distToLeader'] as num).toInt()
        : (data['gapM'] is num ? (data['gapM'] as num).abs().toInt() : state.distToLeader);

    final normDist = data['normDistM'] is num ? (data['normDistM'] as num).toInt() : 0;
    if (normDist > 0) {
      _bleService.alignDistance(normDist);
    }

    state = state.copyWith(
      myRank: rk,
      totalRacers: tot,
      distToLeader: dLead,
      distToPrev: data['distToPrev'] is num ? (data['distToPrev'] as num).toInt() : state.distToPrev,
      distToNext: data['distToNext'] is num ? (data['distToNext'] as num).toInt() : state.distToNext,
    );
  }

  /// Finalise la course et envoie le paquet final
  Future<void> _finishRace(RowingMetrics m) async {
    state = state.copyWith(phase: RacePhase.finished);
    HapticFeedback.vibrate();

    try {
      final userId = (await _storage.getUserId()) ?? _userDisplayName;
      final devToken = await _storage.getDeviceToken();
      final deviceId = await _storage.getOrCreateDeviceId();

      final payload = {
        'raceId': state.raceId,
        'userId': userId,
        'userName': _userDisplayName,
        'raceMode': state.gameMode == 'solo' ? 'solo' : 'race',
        'status': 'completed',
        'targetDistance': state.targetDistance,
        'seq': m.strokeCount,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
        'elapsedTime': _sessionChronometerSec,
        'currentDistance': state.targetDistance,
        'instantPower': m.instantPower,
        'instantPace': m.instantPace,
        'strokeRate': m.strokeRate,
        'deviceToken': devToken,
        'deviceId': deviceId,
        'metrics': {
          'distanceM': state.targetDistance,
          'splitSec': m.instantPace,
          'powerWatts': m.instantPower,
          'strokeRate': m.strokeRate,
        },
      };

      final res = await _apiClient.sendBoostTelemetry(payload);
      if (res.statusCode == 200 && res.data is Map) {
        final d = Map<String, dynamic>.from(res.data as Map);
        final top3 = d['top3'] is List ? List<Map<String, dynamic>>.from(d['top3'] as List) : <Map<String, dynamic>>[];
        final pts = d['pointsEarned'] is num ? (d['pointsEarned'] as num).toInt() : 0;

        state = state.copyWith(
          podiumTop3: top3,
          pointsEarned: pts,
          myRank: d['finalRank'] is num ? (d['finalRank'] as num).toInt() : state.myRank,
        );
      }
    } catch (_) {}
  }

  /// Abandon de la course (DNF - 0 point de ligue)
  Future<void> abandonRace() async {
    state = state.copyWith(
      phase: RacePhase.abandoned,
      isAbandoned: true,
    );

    try {
      final userId = (await _storage.getUserId()) ?? _userDisplayName;
      final devToken = await _storage.getDeviceToken();
      final deviceId = await _storage.getOrCreateDeviceId();

      final payload = {
        'raceId': state.raceId,
        'userId': userId,
        'userName': _userDisplayName,
        'raceMode': state.gameMode,
        'status': 'abandoned',
        'targetDistance': state.targetDistance,
        'elapsedTime': _sessionChronometerSec,
        'currentDistance': _bleService.currentMetrics.totalDistance,
        'deviceToken': devToken,
        'deviceId': deviceId,
      };

      await _apiClient.sendBoostTelemetry(payload);
      if (state.isPrivateSalon) {
        await _apiClient.leaveRoom(roomId: state.raceId, userId: userId, deviceToken: devToken);
      }
    } catch (_) {}
  }

  // ==========================================
  // ÉCOUTE WEBSOCKET TEMPS RÉEL
  // ==========================================

  void _onLeaderboardReceived(LeaderboardPayload payload) {
    if (payload.raceId != state.raceId && state.raceId.isNotEmpty) return;

    state = state.copyWith(
      racers: payload.leaderboard,
      totalRacers: payload.leaderboard.length,
    );
  }

  void _onStatusChangeReceived(Map<String, dynamic> data) {
    final newStatus = data['status']?.toString();
    if (newStatus == 'in_progress' || newStatus == 'RUNNING') {
      if (state.phase == RacePhase.lobbyWaiting || state.phase == RacePhase.countdown15s) {
        state = state.copyWith(
          phase: RacePhase.racing,
          countdownSeconds: 0,
        );
        _bleService.reTareToZero();
      }
    }
  }

  void _onPrivateUpdateReceived(Map<String, dynamic> data) {
    if (data['secondsRemaining'] is num) {
      final cd = (data['secondsRemaining'] as num).toInt();
      if (cd > 0 && cd <= 15 && state.phase != RacePhase.racing && state.phase != RacePhase.finished) {
        final currentCd = state.countdownSeconds;
        final monotonicCd = (state.phase == RacePhase.countdown15s && currentCd > 0 && currentCd <= 15)
            ? (cd < currentCd && (currentCd - cd > 2) ? cd : currentCd)
            : cd;
        state = state.copyWith(
          phase: RacePhase.countdown15s,
          countdownSeconds: monotonicCd,
        );
      }
    }
    if (data['waitingStatusMessage'] != null) {
      state = state.copyWith(waitingStatusMessage: data['waitingStatusMessage'].toString());
    }
  }

  void dispose() {
    _bleMetricsSub?.cancel();
    _socketLeaderboardSub?.cancel();
    _socketStatusSub?.cancel();
    _socketPrivateSub?.cancel();
    _oneSecondTimer?.cancel();
  }
}
