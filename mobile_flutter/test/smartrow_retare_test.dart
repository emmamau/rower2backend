import 'package:flutter_test/flutter_test.dart';
import 'package:rower_race_mobile/features/ble/services/ble_ftms_decoder.dart';

void main() {
  test('reTareToZero avant le premier paquet conserve la tare initiale SmartRow', () {
    final decoder = BleFtmsDecoder();
    decoder.reset();
    decoder.isFirstPacket = true;
    decoder.reTareToZero(); // appele au demarrage de session, avant toute trame

    // Distance cumulee brute de la poulie : 1000 m, 10 coups
    var m = decoder.decodeSmartRowBytes('d010002540010\r'.codeUnits);
    expect(m.totalDistance, equals(0));
    expect(m.strokeCount, equals(0));
    expect(m.strokeRate, equals(25.4));

    m = decoder.decodeSmartRowBytes('d010152540012\r'.codeUnits, m);
    expect(m.totalDistance, equals(15));
    expect(m.strokeCount, equals(2));
  });
}
