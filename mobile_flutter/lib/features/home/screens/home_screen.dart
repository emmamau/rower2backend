import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/i18n_service.dart';
import '../../auth/controllers/auth_controller.dart';
import '../../auth/models/user_profile.dart';
import '../../auth/widgets/login_modal.dart';
import '../../auth/widgets/claim_code_modal.dart';
import '../../ble/models/rowing_metrics.dart';
import '../../ble/services/ble_ftms_service.dart';
import '../../ble/widgets/ble_scanner_sheet.dart';
import '../../race/controllers/race_controller.dart';
import '../../race/screens/race_screen.dart';

/// Écran d'accueil mobile épuré offrant 3 accès directs et l'état en direct du rameur BLE.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  void _showBleScanner(BuildContext context) {
    BleScannerSheet.show(context);
  }

  void _showLogin(BuildContext context) {
    LoginModal.show(context);
  }

  void _showClaimCode(BuildContext context, WidgetRef ref) async {
    final result = await ClaimCodeModal.show(context);
    if (result != null && context.mounted) {
      ref.read(raceControllerProvider.notifier).setupFromPrivateRoom(result);
      final roomId = result['raceId']?.toString() ?? result['id']?.toString() ?? 'salon';
      final target = result['targetDistance'] is num
          ? (result['targetDistance'] as num).toDouble()
          : 2000.0;
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (context) => RaceScreen(
            roomId: roomId,
            targetDistance: target,
          ),
        ),
      );
    }
  }

  void _joinQuickRace(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => const RaceScreen(
          roomId: 'public-500',
          targetDistance: 500.0,
        ),
      ),
    );
  }

  void _joinSoloTraining(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => const RaceScreen(
          roomId: 'solo-training',
          targetDistance: 2000.0,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authControllerProvider);
    final bleStatusAsync = ref.watch(bleConnectionStatusProvider);
    final bleDeviceName = ref.watch(connectedDeviceNameProvider);
    final currentLang = ref.watch(i18nProvider);
    final i18n = ref.read(i18nProvider.notifier);

    final isBleConnected = bleStatusAsync.valueOrNull == BleConnectionStatus.connected;

    return Scaffold(
      backgroundColor: const Color(0xFF0F141E),
      appBar: AppBar(
        backgroundColor: const Color(0xFF141A28),
        elevation: 0,
        title: Row(
          children: [
            const Icon(Icons.rowing, color: Colors.cyanAccent),
            const SizedBox(width: 8),
            const Text(
              'ROWERRACE',
              style: TextStyle(
                fontWeight: FontWeight.w900,
                letterSpacing: 2.0,
                fontSize: 18,
              ),
            ),
          ],
        ),
        actions: [
          // Sélecteur de langue (FR / EN)
          IconButton(
            tooltip: i18n.t('language'),
            icon: Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white24),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                currentLang.toUpperCase(),
                style: const TextStyle(
                  color: Colors.cyanAccent,
                  fontWeight: FontWeight.bold,
                  fontSize: 11,
                ),
              ),
            ),
            onPressed: () {
              final nextLang = currentLang == 'fr' ? 'en' : 'fr';
              ref.read(i18nProvider.notifier).setLanguage(nextLang);
            },
          ),
          // Bouton BLE Status
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: InkWell(
              onTap: () => _showBleScanner(context),
              borderRadius: BorderRadius.circular(20),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: isBleConnected
                      ? Colors.greenAccent.withOpacity(0.15)
                      : Colors.redAccent.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: isBleConnected ? Colors.greenAccent : Colors.redAccent,
                    width: 1.2,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      isBleConnected ? Icons.bluetooth_connected : Icons.bluetooth_disabled,
                      color: isBleConnected ? Colors.greenAccent : Colors.redAccent,
                      size: 16,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      isBleConnected
                          ? (bleDeviceName ?? (currentLang == 'fr' ? 'Rameur' : 'Rower'))
                          : i18n.t('ble_disconnected'),
                      style: TextStyle(
                        color: isBleConnected ? Colors.greenAccent : Colors.redAccent,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Bannière Utilisateur & Ligue
              _buildUserBanner(context, ref, authState),
              const SizedBox(height: 24),

              // Avertissement BLE si non connecté
              if (!isBleConnected) ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.amber.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.amberAccent.withOpacity(0.4)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.info_outline, color: Colors.amberAccent, size: 24),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          currentLang == 'fr'
                              ? 'Connectez votre rameur Bluetooth FTMS pour démarrer une régate ou un entraînement.'
                              : 'Connect your Bluetooth FTMS rower to start a regatta or workout.',
                          style: TextStyle(color: Colors.amber.shade100, fontSize: 13),
                        ),
                      ),
                      TextButton(
                        onPressed: () => _showBleScanner(context),
                        child: Text(currentLang == 'fr' ? 'SCANNER' : 'SCAN',
                            style: const TextStyle(
                                color: Colors.cyanAccent, fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
              ],

              Text(
                currentLang == 'fr' ? 'MODES DE COURSE' : 'RACE MODES',
                style: const TextStyle(
                  color: Colors.white54,
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.5,
                ),
              ),
              const SizedBox(height: 12),

              // Carte 1 : Course Rapide / Salon Public
              _ActionCard(
                title: currentLang == 'fr' ? 'COURSE RAPIDE (500m)' : 'QUICK RACE (500m)',
                subtitle: currentLang == 'fr'
                    ? 'Rejoignez immédiatement une régate publique multijoueur avec d\'autres rameurs et des bots.'
                    : 'Instantly join a multiplayer public regatta with other rowers and bots.',
                icon: Icons.flash_on,
                accentColor: Colors.cyanAccent,
                onTap: () => _joinQuickRace(context),
              ),
              const SizedBox(height: 14),

              // Carte 2 : Rejoindre un Salon Privé (Code 5 Caractères)
              _ActionCard(
                title: currentLang == 'fr' ? 'REJOINDRE UN SALON PRIVÉ' : 'JOIN PRIVATE ROOM',
                subtitle: currentLang == 'fr'
                    ? 'Entrez un code unique à 5 caractères pour affronter vos amis ou lier votre session.'
                    : 'Enter a unique 5-character code to race friends or link your session.',
                icon: Icons.vpn_key,
                accentColor: Colors.purpleAccent,
                onTap: () => _showClaimCode(context, ref),
              ),
              const SizedBox(height: 14),

              // Carte 3 : Cockpit / Entraînement Libre
              _ActionCard(
                title: currentLang == 'fr' ? 'COCKPIT & ENTRAÎNEMENT LIBRE' : 'COCKPIT & FREE TRAINING',
                subtitle: currentLang == 'fr'
                    ? 'Session solo avec affichage haute lisibilité : Watts, SPM, Allure /500m et distance libre.'
                    : 'Solo session with high-visibility HUD: Watts, SPM, 500m pace, and open distance.',
                icon: Icons.speed,
                accentColor: Colors.amberAccent,
                onTap: () => _joinSoloTraining(context),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildUserBanner(
      BuildContext context, WidgetRef ref, AsyncValue<UserProfile?> authAsync) {
    final currentLang = ref.watch(i18nProvider);
    final i18n = ref.read(i18nProvider.notifier);
    final user = authAsync.valueOrNull;
    final isGuest = user == null;
    final displayName = user?.displayPseudo ?? i18n.t('guest_mode');
    final league = user?.league ?? LeagueTier.bronze;
    final points = user?.leaguePoints ?? 0;

    Color leagueColor = Colors.grey;
    if (league == LeagueTier.gold) leagueColor = Colors.amber;
    if (league == LeagueTier.silver) leagueColor = const Color(0xFFC0C0C0);
    if (league == LeagueTier.bronze) leagueColor = const Color(0xFFCD7F32);
    if (league == LeagueTier.diamond) leagueColor = Colors.cyanAccent;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF141A28),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 26,
            backgroundColor: leagueColor.withOpacity(0.2),
            child: Icon(Icons.person, color: leagueColor, size: 28),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  displayName,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: leagueColor.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(color: leagueColor, width: 0.8),
                      ),
                      child: Text(
                        currentLang == 'fr'
                            ? 'Ligue ${league.displayName}'
                            : '${league.displayName} League',
                        style: TextStyle(
                          color: leagueColor,
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      currentLang == 'fr' ? '$points pts hebdo' : '$points weekly pts',
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (isGuest)
            OutlinedButton(
              onPressed: () => _showLogin(context),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: Colors.cyanAccent),
                foregroundColor: Colors.cyanAccent,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              child: Text(i18n.t('login').toUpperCase(),
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
            ),
        ],
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  final String title;
  final String subtitle;
  final IconData icon;
  final Color accentColor;
  final VoidCallback onTap;

  const _ActionCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.accentColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: const Color(0xFF141A28),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: accentColor.withOpacity(0.3), width: 1.2),
          boxShadow: [
            BoxShadow(
              color: accentColor.withOpacity(0.04),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: accentColor.withOpacity(0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: accentColor, size: 28),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 0.8,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      color: Colors.white60,
                      fontSize: 12,
                      height: 1.3,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            const Icon(Icons.arrow_forward_ios, color: Colors.white38, size: 16),
          ],
        ),
      ),
    );
  }
}
