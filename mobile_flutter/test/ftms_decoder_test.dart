import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/features/ble/services/ble_ftms_service.dart';

void main() {
  group('BleFtmsDecoder Tests', () {
    test('Décodage trame standard FTMS 0x2AD1 avec Stroke, Distance, Pace et Power', () {
      final decoder = BleFtmsDecoder();

      // Construction d'une trame FTMS synthétique :
      // Flags (16-bit LE):
      // bit 0 = 0 (More Data = 0 -> Stroke rate and stroke count PRESENT)
      // bit 1 = 0 (Average Stroke rate NOT present)
      // bit 2 = 1 (Total Distance PRESENT = 0x0004)
      // bit 3 = 1 (Instantaneous Pace PRESENT = 0x0008)
      // bit 4 = 0 (Average Pace NOT present)
      // bit 5 = 1 (Instantaneous Power PRESENT = 0x0020)
      // Total flags = 0x002C -> Little endian: [0x2C, 0x00]
      //
      // Payload:
      // Stroke Count (uint16): 42 -> [0x2A, 0x00]
      // Stroke Rate (uint8, 0.5 SPM resolution): 56 (soit 28.0 SPM) -> [0x38]
      // Total Distance (uint24): 250m -> [0xFA, 0x00, 0x00]
      // Instantaneous Pace (uint16): 120s (soit 2:00/500m) -> [0x78, 0x00]
      // Instantaneous Power (sint16): 200W -> [0xC8, 0x00]

      final packet = <int>[
        0x2C, 0x00, // flags
        0x2A, 0x00, // stroke count = 42
        0x38, // stroke rate = 56 (28 SPM)
        0xFA, 0x00, 0x00, // distance = 250m
        0x78, 0x00, // pace = 120s
        0xC8, 0x00, // power = 200W
      ];

      final metrics = decoder.decode(packet);

      expect(metrics.cadenceSpm, equals(28));
      expect(metrics.totalStrokes, equals(42));
      expect(metrics.distanceMeters, equals(250.0));
      expect(metrics.instantPaceSeconds, equals(120));
      expect(metrics.powerWatts, equals(200));
      expect(metrics.formattedPace, equals('02:00/500m'));
    });

    test('Dérivation physique Concept2 de l\'allure quand pace est absent mais watts présents', () {
      final decoder = BleFtmsDecoder();

      // Flags : Pas de pace (bit 3 = 0), Power présent (bit 5 = 1, 0x0020), More Data = 1 (bit 0 = 1, pas de stroke)
      // Flags = 0x0021 -> [0x21, 0x00]
      // Power = 250 W -> [0xFA, 0x00]
      final packet = <int>[
        0x21, 0x00, // flags
        0xFA, 0x00, // power = 250 W
      ];

      final metrics = decoder.decode(packet);

      expect(metrics.powerWatts, equals(250));
      // pace = (2.80 / 250)^(1/3) * 500 = (0.0112)^0.33333 * 500 =~ 0.22373 * 500 = 111.8s =~ 112s (1:52/500m)
      expect(metrics.instantPaceSeconds, inInclusiveRange(110, 114));
      expect(metrics.formattedPace, contains('/500m'));
    });

    test('Détection automatique et normalisation des décimètres (rameurs Merach / Domyos)', () {
      final decoder = BleFtmsDecoder();

      // Première trame : distance = 200 (dm ou m ?)
      // Deuxième trame : distance = 1500 (1500 dm = 150m en 1 seconde)
      final packet1 = <int>[
        0x25, 0x00, // flags: distance présente
        0xC8, 0x00, 0x00, // 200
      ];

      decoder.decode(packet1);

      final packet2 = <int>[
        0x25, 0x00,
        0xDC, 0x05, 0x00, // 1500
      ];

      final metrics2 = decoder.decode(packet2);
      // Avec un delta de 1300 en 1 coup, le décodeur détecte les décimètres et divise par 10
      expect(metrics2.distanceMeters, equals(150.0));
    });

    test('Tare matérielle (reTareToZero)', () {
      final decoder = BleFtmsDecoder();

      // Trame simulant une séance précédente ou un compteur non remis à zéro : 350m
      final packet1 = <int>[
        0x25, 0x00,
        0x5E, 0x01, 0x00, // 350m
      ];

      final m1 = decoder.decode(packet1);
      expect(m1.distanceMeters, equals(350.0));

      // Remise à zéro pour la course
      decoder.reTareToZero();

      // Même trame reçue : la distance tarée doit être à 0
      final m2 = decoder.decode(packet1);
      expect(m2.distanceMeters, equals(0.0));

      // Rameur avance de 10m (compteur brut = 360m)
      final packet2 = <int>[
        0x25, 0x00,
        0x68, 0x01, 0x00, // 360m
      ];

      final m3 = decoder.decode(packet2);
      expect(m3.distanceMeters, equals(10.0));
    });
  });
}
