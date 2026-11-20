import 'package:flutter_test/flutter_test.dart';
import 'package:rower_race_mobile/features/ble/models/rowing_metrics.dart';
import 'package:rower_race_mobile/features/race/models/race_session_state.dart';

void main() {
  group('Race State Machine & Anti-Cheat Tests', () {
    test('État initial correct lors de l\'initialisation', () {
      const state = RaceSessionState(raceId: 'test-room', targetDistance: 500);

      expect(state.phase, equals(RacePhase.idle));
      expect(state.isBleRowerReady, isFalse);
      expect(state.myDistance, equals(0.0));
      expect(state.isFalseStartWarningActive, isFalse);
      expect(state.isFalseStartPenaltyLocked, isFalse);
      expect(state.isAbandoned, isFalse);
      expect(state.isFinished, isFalse);
    });

    test('Détection automatique du premier coup de rame (réveil)', () {
      var state = const RaceSessionState(
        raceId: 'private-123',
        targetDistance: 500,
        isPrivateSalon: true,
        phase: RacePhase.lobbyWaiting,
      );

      // Métrique au repos : 0 W, 0 SPM
      const restMetric = RowingMetrics(
        instantPower: 0,
        strokeRate: 0.0,
        totalDistance: 0,
        instantPace: 0,
        strokeCount: 0,
        calories: 0,
        isMoving: false,
      );

      final isRestAwake = restMetric.instantPower > 0 || restMetric.strokeRate > 0.0 || restMetric.isMoving;
      expect(isRestAwake, isFalse);

      // Coup de rame détecté : 150 W, 24 SPM
      const strokeMetric = RowingMetrics(
        instantPower: 150,
        strokeRate: 24.0,
        totalDistance: 2,
        instantPace: 125,
        strokeCount: 1,
        calories: 1,
        isMoving: true,
      );

      final isStrokeAwake = strokeMetric.instantPower > 0 || strokeMetric.strokeRate > 0.0 || strokeMetric.isMoving;
      expect(isStrokeAwake, isTrue);

      if (isStrokeAwake && !state.isBleRowerReady && state.isPrivateSalon) {
        state = state.copyWith(
          isBleRowerReady: true,
          waitingStatusMessage: 'Rameur prêt - En attente du départ',
        );
      }

      expect(state.isBleRowerReady, isTrue);
      expect(state.waitingStatusMessage, contains('Rameur prêt'));
    });

    test('Alerte Faux Départ pendant le décompte 15s si watts > 0 ou spm > 0', () {
      var state = const RaceSessionState(
        raceId: 'room-500',
        targetDistance: 500,
        phase: RacePhase.countdown15s,
        countdownSeconds: 10,
      );

      // Rameur bouge pendant le décompte (180 W)
      const movingMetric = RowingMetrics(
        instantPower: 180,
        strokeRate: 26.0,
        totalDistance: 15,
        instantPace: 120,
        strokeCount: 5,
        isMoving: true,
      );

      final isMoving = movingMetric.instantPower > 0 || movingMetric.strokeRate > 0.0 || movingMetric.isMoving;
      if (state.phase == RacePhase.countdown15s && state.countdownSeconds > 0 && isMoving) {
        state = state.copyWith(isFalseStartWarningActive: true);
      }

      expect(state.isFalseStartWarningActive, isTrue);
      expect(state.isCountingDownWarning, isTrue);

      // Arrêt complet du rameur
      const stoppedMetric = RowingMetrics(
        instantPower: 0,
        strokeRate: 0.0,
        totalDistance: 15,
        instantPace: 0,
        strokeCount: 5,
        isMoving: false,
      );

      final isStopped = stoppedMetric.instantPower == 0 && stoppedMetric.strokeRate == 0.0;
      if (state.phase == RacePhase.countdown15s && isStopped) {
        state = state.copyWith(isFalseStartWarningActive: false);
      }

      expect(state.isFalseStartWarningActive, isFalse);
    });

    test('Pénalité T=0 : blocage à 0m si rameur n\'est pas à l\'arrêt complet au départ', () {
      // Décompte termine, passage à T=0
      var state = const RaceSessionState(
        raceId: 'room-500',
        targetDistance: 500,
        phase: RacePhase.countdown15s,
        countdownSeconds: 0,
      );

      // Rameur est à 220 W au signal (non arrêté)
      const nonStoppedMetric = RowingMetrics(
        instantPower: 220,
        strokeRate: 30.0,
        totalDistance: 25,
        instantPace: 115,
        strokeCount: 8,
        isMoving: true,
      );

      final isStillMoving = nonStoppedMetric.instantPower > 0 || nonStoppedMetric.strokeRate > 0.0 || nonStoppedMetric.isMoving;

      if (isStillMoving) {
        state = state.copyWith(
          phase: RacePhase.racing,
          countdownSeconds: 0,
          isFalseStartPenaltyLocked: true,
          isFalseStartWarningActive: false,
        );
      }

      expect(state.isFalseStartPenaltyLocked, isTrue);
      expect(state.isStartBlockedWarning, isTrue);
      expect(state.phase, equals(RacePhase.racing));

      // L'utilisateur s'arrête complètement (0 W, 0 SPM)
      const stoppedMetric = RowingMetrics(
        instantPower: 0,
        strokeRate: 0.0,
        totalDistance: 25,
        isMoving: false,
      );

      final isCompletelyStopped = stoppedMetric.instantPower == 0 && stoppedMetric.strokeRate == 0.0;
      if (isCompletelyStopped) {
        state = state.copyWith(isFalseStartPenaltyLocked: false);
      }

      expect(state.isFalseStartPenaltyLocked, isFalse);
      expect(state.isStartBlockedWarning, isFalse);
    });

    test('Abandon en cours de route (DNF)', () {
      var state = const RaceSessionState(
        raceId: 'room-500',
        targetDistance: 500,
        phase: RacePhase.racing,
      );

      // Abandon volontaire
      state = state.copyWith(
        phase: RacePhase.abandoned,
        isAbandoned: true,
      );

      expect(state.isAbandoned, isTrue);
      expect(state.isDnf, isTrue);
      expect(state.phase, equals(RacePhase.abandoned));
    });
  });
}
