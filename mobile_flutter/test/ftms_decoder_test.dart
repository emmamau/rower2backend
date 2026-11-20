import 'package:flutter_test/flutter_test.dart';
import 'package:rower_race_mobile/features/ble/services/ble_ftms_decoder.dart';

void main() {
  group('BleFtmsDecoder Tests', () {
    test('Décodage trame standard FTMS 0x2AD1 avec Stroke, Distance, Pace et Power', () {
      final decoder = BleFtmsDecoder();

      // Flags (16-bit LE):
      // bit 0 = 0 (More Data = 0 -> Stroke rate [uint8] and stroke count [uint16] PRESENT)
      // bit 1 = 0 (Average Stroke rate NOT present)
      // bit 2 = 1 (Total Distance PRESENT = 0x0004)
      // bit 3 = 1 (Instantaneous Pace PRESENT = 0x0008)
      // bit 4 = 0 (Average Pace NOT present)
      // bit 5 = 1 (Instantaneous Power PRESENT = 0x0020)
      // Total flags = 0x002C -> Little endian: [0x2C, 0x00]
      //
      // Payload selon Bluetooth SIG FTMS §4.14 :
      // 1. Stroke Rate (uint8, 0.5 SPM resolution): 56 (soit 28.0 SPM) -> [0x38]
      // 2. Stroke Count (uint16 LE): 42 -> [0x2A, 0x00]
      // 3. Total Distance (uint24 LE): 250m -> [0xFA, 0x00, 0x00]
      // 4. Instantaneous Pace (uint16 LE): 120s (soit 2:00/500m) -> [0x78, 0x00]
      // 5. Instantaneous Power (sint16 LE): 200W -> [0xC8, 0x00]

      final packet = <int>[
        0x2C, 0x00, // flags
        0x38, // stroke rate = 56 (28.0 SPM)
        0x2A, 0x00, // stroke count = 42
        0xFA, 0x00, 0x00, // distance = 250m
        0x78, 0x00, // pace = 120s
        0xC8, 0x00, // power = 200W
      ];

      final metrics = decoder.decode(packet);

      expect(metrics.strokeRate, equals(28.0));
      expect(metrics.cadenceSpm, equals(28.0));
      expect(metrics.strokeCount, equals(42));
      expect(metrics.totalStrokes, equals(42));
      expect(metrics.totalDistance, equals(250));
      expect(metrics.distanceMeters, equals(250.0));
      expect(metrics.instantPace, equals(120));
      expect(metrics.instantPaceSeconds, equals(120));
      expect(metrics.instantPower, equals(200));
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

      expect(metrics.instantPower, equals(250));
      // pace = (2.80 / 250)^(1/3) * 500 = (0.0112)^0.33333 * 500 =~ 0.22373 * 500 = 111.8s =~ 112s (1:52/500m)
      expect(metrics.instantPace, inInclusiveRange(110, 114));
      expect(metrics.formattedPace, contains('/500m'));
    });

    test('Détection automatique et normalisation des décimètres (rameurs Merach / Domyos)', () {
      final decoder = BleFtmsDecoder(deviceName: 'MERACH MR-600');
      decoder.isFirstPacket = true;

      // Première trame : distance = 200 dm (20 m)
      final packet1 = <int>[
        0x24, 0x00, // flags: bit 0=0 (stroke present), bit 2=1 (distance)
        0x30, // stroke rate = 48 (24 SPM)
        0x01, 0x00, // strokes = 1
        0xC8, 0x00, 0x00, // 200 dm
      ];
      decoder.decode(packet1);

      // Deuxième trame : distance grimpe de 1300 dm en 1 coup (1500 dm = 150 m)
      final packet2 = <int>[
        0x24, 0x00,
        0x30,
        0x02, 0x00, // strokes = 2
        0xDC, 0x05, 0x00, // 1500 dm
      ];

      final metrics2 = decoder.decode(packet2);
      expect(decoder.isDecimeterDistance, isTrue);
      // Distance normalisée en mètres (150 m - baseline 20 m = 130 m)
      expect(metrics2.totalDistance, equals(130));
    });

    test('Tare matérielle (reTareToZero)', () {
      final decoder = BleFtmsDecoder();

      // Première trame : 350m
      final packet1 = <int>[
        0x24, 0x00, // bit 0 = 0 (stroke), bit 2 = 1 (distance)
        0x30, // 24 spm
        0x05, 0x00, // 5 strokes
        0x5E, 0x01, 0x00, // 350m
      ];

      final m1 = decoder.decode(packet1);
      expect(m1.totalDistance, equals(350));

      // Deuxième trame : 450m (+100m)
      final packet2 = <int>[
        0x24, 0x00,
        0x30,
        0x10, 0x00, // 16 strokes
        0xC2, 0x01, 0x00, // 450m
      ];
      final m2 = decoder.decode(packet2);
      expect(m2.totalDistance, equals(450));

      // Remise à zéro pour le départ de course T=0
      decoder.reTareToZero();

      // Même trame reçue : distance tarée doit être à 0
      final m3 = decoder.decode(packet2);
      expect(m3.totalDistance, equals(0));

      // Rameur avance de 10m de plus (460m)
      final packet3 = <int>[
        0x24, 0x00,
        0x30,
        0x12, 0x00,
        0xCC, 0x01, 0x00, // 460m
      ];
      final m4 = decoder.decode(packet3);
      expect(m4.totalDistance, equals(10));
    });
  });
}
