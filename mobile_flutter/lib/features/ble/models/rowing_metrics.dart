enum BleConnectionStatus {
  disconnected,
  scanning,
  connecting,
  connected,
}

class RowingMetrics {
  final int instantPower; // Watts
  final int avgPower;
  final int instantPace; // Secondes par 500m
  final int avgPace;
  final double strokeRate; // SPM
  final double avgStrokeRate;
  final int totalDistance; // Mètres réels tarés
  final int strokeCount;
  final int elapsedTime; // Secondes
  final int calories;
  final int heartRate;
  final bool isMoving;

  const RowingMetrics({
    this.instantPower = 0,
    this.avgPower = 0,
    this.instantPace = 0,
    this.avgPace = 0,
    this.strokeRate = 0.0,
    this.avgStrokeRate = 0.0,
    this.totalDistance = 0,
    this.strokeCount = 0,
    this.elapsedTime = 0,
    this.calories = 0,
    this.heartRate = 0,
    this.isMoving = false,
  });

  // Getters de commodité & compatibilité
  int get powerWatts => instantPower;
  double get cadenceSpm => strokeRate;
  double get distanceMeters => totalDistance.toDouble();
  int get instantPaceSeconds => instantPace;
  int get totalStrokes => strokeCount;
  int get caloriesKcal => calories;

  /// Formate l'allure en mm:ss/500m
  String get formattedPace {
    if (instantPace <= 0 || instantPace >= 1800) return '--:--';
    final m = instantPace ~/ 60;
    final s = instantPace % 60;
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}/500m';
  }

  /// Formate l'allure moyenne en mm:ss/500m
  String get formattedAvgPace {
    if (avgPace <= 0 || avgPace >= 1800) return '--:--';
    final m = avgPace ~/ 60;
    final s = avgPace % 60;
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}/500m';
  }

  /// Vitesse en km/h calculée sur l'allure
  double get speedKmh {
    if (instantPace > 0 && instantPace < 600) {
      return (500.0 / instantPace) * 3.6;
    }
    return 0.0;
  }

  RowingMetrics copyWith({
    int? instantPower,
    int? avgPower,
    int? instantPace,
    int? avgPace,
    double? strokeRate,
    double? avgStrokeRate,
    int? totalDistance,
    int? strokeCount,
    int? elapsedTime,
    int? calories,
    int? heartRate,
    bool? isMoving,
  }) {
    return RowingMetrics(
      instantPower: instantPower ?? this.instantPower,
      avgPower: avgPower ?? this.avgPower,
      instantPace: instantPace ?? this.instantPace,
      avgPace: avgPace ?? this.avgPace,
      strokeRate: strokeRate ?? this.strokeRate,
      avgStrokeRate: avgStrokeRate ?? this.avgStrokeRate,
      totalDistance: totalDistance ?? this.totalDistance,
      strokeCount: strokeCount ?? this.strokeCount,
      elapsedTime: elapsedTime ?? this.elapsedTime,
      calories: calories ?? this.calories,
      heartRate: heartRate ?? this.heartRate,
      isMoving: isMoving ?? this.isMoving,
    );
  }
}
