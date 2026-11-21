import 'package:flutter_test/flutter_test.dart';
import 'package:rower_race_mobile/features/ble/services/ble_ftms_decoder.dart';

void main() {
  group('BleFtmsDecoder Tests (FTMS 0x2AD1 & SmartRow Direct 0x1236)', () {
    test('Décodage trame standard FTMS 0x2AD1 avec Stroke, Distance, Pace et Power', () {
      final decoder = BleFtmsDecoder();

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

      final packet = <int>[
        0x21, 0x00, // flags
        0xFA, 0x00, // power = 250 W
      ];

      final metrics = decoder.decode(packet);

      expect(metrics.instantPower, equals(250));
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
        0x24, 0x00,
        0x30,
        0x05, 0x00,
        0x5E, 0x01, 0x00, // 350m
      ];

      final m1 = decoder.decode(packet1);
      expect(m1.totalDistance, equals(350));

      // Deuxième trame : 450m (+100m)
      final packet2 = <int>[
        0x24, 0x00,
        0x30,
        0x10, 0x00,
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

    test('Broadcast EXR SmartRow : trames FTMS scindées (More Data=1) préservent la tare initiale et les Watts', () {
      final decoder = BleFtmsDecoder(deviceName: 'SmartRow EXR');
      decoder.isFirstPacket = true;

      // Trame 1 : trame de continuation (Bit 0 = 1 More Data, pas de distance ni de coups, seulement Pace=115s et Power=210W)
      final splitContinuation = <int>[
        0x29, 0x00, // Bit 0=1, Bit 3=1 (Pace), Bit 5=1 (Power)
        115, 0, // 115s / 500m
        210, 0, // 210W
      ];
      var m = decoder.decode(splitContinuation);
      expect(m.instantPower, equals(210));
      expect(m.instantPace, equals(115));
      // La tare de distance doit encore être en attente car aucune distance n'a été reçue dans la trame 1
      expect(decoder.isFirstPacket, isTrue);

      // Trame 2 : trame primaire (Bit 0 = 0, Bit 2 = 1) avec un compteur SmartRow déjà à 1200m et 110 coups
      final splitPrimary = <int>[
        0x04, 0x00, // Bit 0=0 (SPM+Strokes), Bit 2=1 (Distance)
        56, // 28.0 SPM
        110, 0, // 110 strokes
        0xB0, 0x04, 0x00, // 1200m
      ];
      m = decoder.decode(splitPrimary, m);

      // La distance initiale de 1200m doit être tarée à 0m (sans faux positif décimètre) et les 210W préservés !
      expect(decoder.isDecimeterDistance, isFalse);
      expect(m.totalDistance, equals(0));
      expect(m.strokeCount, equals(0));
      expect(m.strokeRate, equals(28.0));
      expect(m.instantPower, equals(210));
    });

    test('Poulie WaterRower SmartRow Direct (0x1236) : décodage complet des trames ASCII a, b, c, d, e, f', () {
      final decoder = BleFtmsDecoder(deviceName: 'SmartRow');

      // 1. Trame Force 'f' : 1250m, 685N
      var m = decoder.decodeSmartRowString('f 1250 0685 ');
      expect(m.totalDistance, equals(1250));
      expect(m.isMoving, isTrue);

      // 2. Trame Travail 'b' : 404.7 J, 98 cm
      m = decoder.decodeSmartRowString('b 1250 4047 98D8', m);
      expect(decoder.lastSmartRowWork, closeTo(404.7, 0.1));
      expect(decoder.lastSmartRowHandleCm, equals(98));

      // 3. Trame Puissance 'c' : 225 W, moyenne 198.5 W (arrondi 199 W)
      m = decoder.decodeSmartRowString('c 125022501985', m);
      expect(m.instantPower, equals(225));
      expect(m.avgPower, equals(199));

      // 4. Trame Cadence 'd' : 30.0 SPM ("300"), 142 coups
      m = decoder.decodeSmartRowString('d 12503000142', m);
      expect(m.strokeRate, equals(30.0));
      expect(m.strokeCount, equals(142));

      // 5. Trame Allure 'e' : 1:52 (112s), moyenne 1:58 (118s)
      m = decoder.decodeSmartRowString('e 1250152158', m);
      expect(m.instantPace, equals(112));
      expect(m.avgPace, equals(118));

      // 6. Trame Énergie 'a' : 85 kcal
      m = decoder.decodeSmartRowString('a 12500085', m);
      expect(m.calories, equals(85));

      // 7. Signal d'arrêt 'f' avec '!' et force 0
      m = decoder.decodeSmartRowString('f 1250 0000!', m);
      expect(m.instantPower, equals(0));
      expect(m.strokeRate, equals(0.0));
      expect(m.isMoving, isFalse);
    });

    test('SmartRow V3 : détection trame verrouillée, calcul challenge KEYLOCK et secours mécanique Watts', () {
      final lockedFrame = <int>[
        0x63, 0x40, 0x40, 0x40, 0x42, 0x46, 0x20, 0x20, 0x30, 0x20, 0x20, 0x34, 0x34, 0x31, 0x46, 0x34, 0x0D
      ];
      final unlockedFrame = <int>[
        0x63, 0x20, 0x31, 0x32, 0x35, 0x30, 0x32, 0x32, 0x35, 0x30, 0x31, 0x39, 0x38, 0x35, 0x0D
      ];

      expect(BleFtmsDecoder.isSmartRowV3LockedFrame(lockedFrame), isTrue);
      expect(BleFtmsDecoder.isSmartRowV3LockedFrame(unlockedFrame), isFalse);

      // Validation mathématique du challenge SmartRow V3 KEYLOCK=C2D70BB1
      final resp = BleFtmsDecoder.computeSmartRowKeylockResponse('KEYLOCK=C2D70BB1');
      expect(resp, isNotNull);
      expect(resp!.length, equals(6));
      expect(resp.first, equals(0x0D));
      expect(resp.last, equals(0x0D));

      // Décodage d'une séquence V3 verrouillée : désembrouillage distance (26m) + calcul mécanique P = Work * SPM / 60
      final decoder = BleFtmsDecoder();
      var m = decoder.decodeSmartRowString('b00026 3500105'); // 350.0 J
      m = decoder.decodeSmartRowString('d000262400003', m); // 24.0 SPM
      m = decoder.decodeSmartRowBytes(lockedFrame, m); // 'c' verrouillée avec "  0" W et distance V3 "@@@BF" = 00026m

      expect(m.totalDistance, equals(26));
      // 350.0 J * 24.0 SPM / 60 = 140 W
      expect(m.instantPower, equals(140));
    });

    test('SmartRow Direct : réassemblage de trames fragmentées sur 2 notifications BLE et multi-trames', () {
      final decoder = BleFtmsDecoder();

      // Fragment 1 (10 octets sans '\r') : "b00026 350"
      final chunk1 = 'b00026 350'.codeUnits;
      var m = decoder.decodeSmartRowBytes(chunk1);
      expect(decoder.lastSmartRowWork, equals(0.0));

      // Fragment 2 (5 octets avec '\r') : "0105\r"
      final chunk2 = '0105\r'.codeUnits;
      m = decoder.decodeSmartRowBytes(chunk2, m);
      expect(decoder.lastSmartRowWork, equals(350.0));
      expect(decoder.lastSmartRowHandleCm, equals(105));

      // Multi-trames dans une seule notification BLE ('c' + 'd')
      final multiPacket = 'c0003520001900\rd000352600004\r'.codeUnits;
      m = decoder.decodeSmartRowBytes(multiPacket, m);
      expect(m.totalDistance, equals(35));
      expect(m.instantPower, equals(200));
      expect(m.strokeRate, equals(26.0));
      expect(m.strokeCount, equals(4));
    });
  });
}
