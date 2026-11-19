import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../config/app_config.dart';
import '../storage/secure_storage_service.dart';
import '../../features/race/models/live_racer_metric.dart';

final realtimeSocketServiceProvider = Provider<RealtimeSocketService>((ref) {
  final storage = ref.watch(secureStorageServiceProvider);
  final service = RealtimeSocketService(storage);
  ref.onDispose(() => service.dispose());
  return service;
});

class RealtimeSocketService with WidgetsBindingObserver {
  final SecureStorageService _storage;
  io.Socket? _socket;

  String? _currentRaceId;
  String? _currentUserId;

  final _connectionStateController = StreamController<bool>.broadcast();
  final _leaderboardController = StreamController<LeaderboardPayload>.broadcast();
  final _statusChangeController = StreamController<Map<String, dynamic>>.broadcast();
  final _privateUpdateController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<bool> get isConnectedStream => _connectionStateController.stream;
  Stream<LeaderboardPayload> get leaderboardStream => _leaderboardController.stream;
  Stream<Map<String, dynamic>> get statusChangeStream => _statusChangeController.stream;
  Stream<Map<String, dynamic>> get privateUpdateStream => _privateUpdateController.stream;

  bool get isConnected => _socket?.connected ?? false;

  RealtimeSocketService(this._storage) {
    WidgetsBinding.instance.addObserver(this);
  }

  /// Initialise la connexion Socket.IO
  Future<void> connect({String? userId}) async {
    _currentUserId = userId;
    final customUrl = await _storage.getCustomApiUrl();
    final serverUrl = (customUrl != null && customUrl.isNotEmpty)
        ? AppConfig.sanitizeUrl(customUrl)
        : AppConfig.defaultBaseUrl;

    _socket?.dispose();

    _socket = io.io(
      serverUrl,
      io.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .enableAutoConnect()
          .enableReconnection()
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(15000)
          .build(),
    );

    _socket!.onConnect((_) {
      _connectionStateController.add(true);
      if (_currentUserId != null && _currentUserId!.isNotEmpty) {
        _socket!.emit('identify', _currentUserId);
      }
      if (_currentRaceId != null && _currentRaceId!.isNotEmpty) {
        _socket!.emit('join_race', _currentRaceId);
      }
    });

    _socket!.onDisconnect((_) {
      _connectionStateController.add(false);
    });

    // Écoute de l'événement de leaderboard en temps réel
    _socket!.on('race:leaderboard_update', (data) {
      if (data is Map) {
        try {
          final payload = LeaderboardPayload.fromMap(Map<String, dynamic>.from(data));
          _leaderboardController.add(payload);
        } catch (_) {}
      }
    });

    // Écoute des changements de statut de course
    _socket!.on('race:status_change', (data) {
      if (data is Map) {
        _statusChangeController.add(Map<String, dynamic>.from(data));
      }
    });

    // Écoute des mises à jour des salons privés (ex: participants, READY)
    _socket!.on('race:private_update', (data) {
      if (data is Map) {
        _privateUpdateController.add(Map<String, dynamic>.from(data));
      }
    });
  }

  /// Rejoint une salle de course spécifique (room race:raceId)
  void joinRace(String raceId) {
    _currentRaceId = raceId;
    if (_socket != null && _socket!.connected) {
      _socket!.emit('join_race', raceId);
    }
  }

  /// Quitte la salle de course
  void leaveRace(String raceId) {
    if (_currentRaceId == raceId) {
      _currentRaceId = null;
    }
    if (_socket != null && _socket!.connected) {
      _socket!.emit('leave_race', raceId);
    }
  }

  /// Gestion du cycle de vie de l'application (maintien/reconnexion au retour en avant-plan)
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (_socket != null && !_socket!.connected) {
        _socket!.connect();
      } else if (_socket != null && _socket!.connected && _currentRaceId != null) {
        _socket!.emit('join_race', _currentRaceId);
      }
    }
  }

  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _socket?.dispose();
    _connectionStateController.close();
    _leaderboardController.close();
    _statusChangeController.close();
    _privateUpdateController.close();
  }
}

class LeaderboardPayload {
  final String raceId;
  final int timestamp;
  final List<LiveRacerMetric> leaderboard;

  LeaderboardPayload({
    required this.raceId,
    required this.timestamp,
    required this.leaderboard,
  });

  factory LeaderboardPayload.fromMap(Map<String, dynamic> map) {
    final rawList = map['leaderboard'] as List? ?? [];
    final list = rawList
        .whereType<Map>()
        .map((e) => LiveRacerMetric.fromMap(Map<String, dynamic>.from(e)))
        .toList();
    return LeaderboardPayload(
      raceId: map['raceId']?.toString() ?? '',
      timestamp: map['timestamp'] is num ? (map['timestamp'] as num).toInt() : 0,
      leaderboard: list,
    );
  }
}
