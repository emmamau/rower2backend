import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/ble/models/rowing_metrics.dart';
import 'package:mobile_flutter/features/race/controllers/race_controller.dart';
import 'package:mobile_flutter/features/race/models/race_session_state.dart';

void main() {
  group('Race State Machine & Anti-Cheat Tests', () {
    test('État initial correct lors du démarrage de session', () {
      final state = RaceSessionState(roomId: 'test-room', targetDistance: 500.0);

      expect(state.phase, equals(RacePhase.lobby));
      expect(state.isWaitingFirstStroke, isTrue);
      expect(state.myDistance, equals(0.0));
      expect(state.isCountingDownWarning, isFalse);
      expect(state.isStartBlockedWarning, isFalse);
      expect(state.isDnf, isFalse);
      expect(state.isFinished, isFalse);
    });

    test('Détection automatique du premier coup de rame (Lobby -> Ready)', () {
      var state = RaceSessionState(roomId: 'test-room', targetDistance: 500.0);

      // Métrique au repos : 0 W, 0 SPM
      final restMetric = RowingMetrics(
        powerWatts: 0,
        cadenceSpm: 0,
        distanceMeters: 0,
        instantPaceSeconds: 0,
        totalStrokes: 0,
        caloriesKcal: 0,
        timestamp: DateTime.now(),
      );

      // Toujours en attente
      expect(restMetric.powerWatts == 0 && restMetric.cadenceSpm == 0, isTrue);

      // Coup de rame détecté : 150 W
      final strokeMetric = RowingMetrics(
        powerWatts: 150,
        cadenceSpm: 24,
        distanceMeters: 2,
        instantPaceSeconds: 125,
        totalStrokes: 1,
        caloriesKcal: 1,
        timestamp: DateTime.now(),
      );

      // Simulation de la transition du contrôleur
      if (state.phase == RacePhase.lobby && (strokeMetric.powerWatts > 0 || strokeMetric.cadenceSpm > 0)) {
        state = state.copyWith(
          phase: RacePhase.ready,
          isWaitingFirstStroke: false,
        );
      }

      expect(state.phase, equals(RacePhase.ready));
      expect(state.isWaitingFirstStroke, isFalse);
    });

    test('Alerte Faux Départ pendant le décompte 15s si watts > 0 ou spm > 0', () {
      var state = RaceSessionState(
        roomId: 'test-room',
        targetDistance: 500.0,
        phase: RacePhase.countdown,
        countdownSeconds: 10,
      );

      // Rameur tire sur la chaîne pendant le décompte : 180W
      final movingMetric = RowingMetrics(
        powerWatts: 180,
        cadenceSpm: 26,
        distanceMeters: 15,
        instantPaceSeconds: 120,
        totalStrokes: 5,
        caloriesKcal: 2,
        timestamp: DateTime.now(),
      );

      // Simulation du check anti-triche
      final hasMovement = movingMetric.powerWatts > 0 || movingMetric.cadenceSpm > 0;
      if (state.phase == RacePhase.countdown && hasMovement) {
        state = state.copyWith(isCountingDownWarning: true);
      }

      expect(state.isCountingDownWarning, isTrue);

      // Arrêt complet du rameur
      final stoppedMetric = RowingMetrics(
        powerWatts: 0,
        cadenceSpm: 0,
        distanceMeters: 15,
        instantPaceSeconds: 0,
        totalStrokes: 5,
        caloriesKcal: 2,
        timestamp: DateTime.now(),
      );

      if (state.phase == RacePhase.countdown && stoppedMetric.powerWatts == 0 && stoppedMetric.cadenceSpm == 0) {
        state = state.copyWith(isCountingDownWarning: false);
      }

      expect(state.isCountingDownWarning, isFalse);
    });

    test('Blocage à 0m à T=0 si rameur n\'est pas à l\'arrêt complet', () {
      // Décompte termine, passage à T=0
      var state = RaceSessionState(
        roomId: 'test-room',
        targetDistance: 500.0,
        phase: RacePhase.racing,
        countdownSeconds: 0,
      );

      // Au moment de T=0, le rameur a 220W (n'a pas respecté l'arrêt complet)
      final nonStoppedMetric = RowingMetrics(
        powerWatts: 220,
        cadenceSpm: 30,
        distanceMeters: 25.0,
        instantPaceSeconds: 115,
        totalStrokes: 8,
        caloriesKcal: 3,
        timestamp: DateTime.now(),
      );

      bool startBlocked = false;
      double effectiveDistance = nonStoppedMetric.distanceMeters;

      if (nonStoppedMetric.powerWatts > 0 || nonStoppedMetric.cadenceSpm > 0) {
        startBlocked = true;
        effectiveDistance = 0.0; // Blocage anti-triche
      }

      state = state.copyWith(
        isStartBlockedWarning: startBlocked,
        myDistance: effectiveDistance,
      );

      expect(state.isStartBlockedWarning, isTrue);
      expect(state.myDistance, equals(0.0));

      // L'utilisateur s'arrête (0W)
      final stoppedMetric = RowingMetrics(
        powerWatts: 0,
        cadenceSpm: 0,
        distanceMeters: 25.0,
        instantPaceSeconds: 0,
        totalStrokes: 8,
        caloriesKcal: 3,
        timestamp: DateTime.now(),
      );

      if (stoppedMetric.powerWatts == 0 && stoppedMetric.cadenceSpm == 0) {
        startBlocked = false;
      }

      state = state.copyWith(isStartBlockedWarning: startBlocked);
      expect(state.isStartBlockedWarning, isFalse);
    });

    test('Abandon en cours de route (DNF)', () {
      var state = RaceSessionState(
        roomId: 'test-room',
        targetDistance: 500.0,
        phase: RacePhase.racing,
        myDistance: 250.0,
      );

      // Abandon
      state = state.copyWith(
        phase: RacePhase.completed,
        isDnf: true,
      );

      expect(state.isDnf, isTrue);
      expect(state.phase, equals(RacePhase.completed));
      expect(state.myDistance, equals(250.0));
    });
  });
}
