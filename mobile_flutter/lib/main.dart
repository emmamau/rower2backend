import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme/app_theme.dart';
import 'core/localization/i18n_service.dart';
import 'features/home/screens/home_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Configuration de l'affichage système (barres de statut et de navigation sombres)
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF0F141E),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );

  // Autoriser l'orientation Portrait et Paysage (idéal pour le support téléphone sur rameur)
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);

  runApp(
    const ProviderScope(
      child: RowerRaceApp(),
    ),
  );
}

class RowerRaceApp extends ConsumerWidget {
  const RowerRaceApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lang = ref.watch(i18nProvider);

    return MaterialApp(
      title: 'RowerRace Mobile',
      debugShowCheckedModeBanner: false,
      locale: Locale(lang),
      theme: AppTheme.darkTheme,
      home: const HomeScreen(),
    );
  }
}
