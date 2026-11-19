import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/controllers/auth_controller.dart';
import '../../auth/widgets/login_modal.dart';
import '../../auth/widgets/claim_code_modal.dart';
import '../../ble/services/ble_ftms_service.dart';
import '../../ble/widgets/ble_scanner_sheet.dart';
import '../../race/screens/race_screen.dart';

/// Écran d'accueil mobile épuré offrant 3 accès directs et l'état en direct du rameur BLE.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  void _showBleScanner(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => const BleScannerSheet(),
    );
  }

  void _showLogin(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => const LoginModal(),
    );
  }

  void _showClaimCode(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => const ClaimCodeModal(),
    );
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
    final bleStatus = ref.watch(bleConnectionStatusProvider);
    final bleDeviceName = ref.watch(connectedDeviceNameProvider);

    final isBleConnected = bleStatus == BleConnectionStatus.connected;

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
                          ? (bleDeviceName ?? 'Rameur')
                          : 'Rameur déconnecté',
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
              _buildUserBanner(context, authState),
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
                          'Connectez votre rameur Bluetooth FTMS pour démarrer une régate ou un entraînement.',
                          style: TextStyle(color: Colors.amber.shade100, fontSize: 13),
                        ),
                      ),
                      TextButton(
                        onPressed: () => _showBleScanner(context),
                        child: const Text('SCANNER', style: TextStyle(color: Colors.cyanAccent, fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
              ],

              const Text(
                'MODES DE COURSE',
                style: TextStyle(
                  color: Colors.white54,
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.5,
                ),
              ),
              const SizedBox(height: 12),

              // Carte 1 : Course Rapide / Salon Public
              _ActionCard(
                title: 'COURSE RAPIDE (500m)',
                subtitle: 'Rejoignez immédiatement une régate publique multijoueur avec d\'autres rameurs et des bots.',
                icon: Icons.flash_on,
                accentColor: Colors.cyanAccent,
                onTap: () => _joinQuickRace(context),
              ),
              const SizedBox(height: 14),

              // Carte 2 : Rejoindre un Salon Privé (Code 5 Caractères)
              _ActionCard(
                title: 'REJOINDRE UN SALON PRIVÉ',
                subtitle: 'Entrez un code unique à 5 caractères pour affronter vos amis ou lier votre session.',
                icon: Icons.vpn_key,
                accentColor: Colors.purpleAccent,
                onTap: () => _showClaimCode(context),
              ),
              const SizedBox(height: 14),

              // Carte 3 : Cockpit / Entraînement Libre
              _ActionCard(
                title: 'COCKPIT & ENTRAÎNEMENT LIBRE',
                subtitle: 'Session solo avec affichage haute lisibilité : Watts, SPM, Allure /500m et distance libre.',
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

  Widget _buildUserBanner(BuildContext context, AuthState authState) {
    Color leagueColor = Colors.grey;
    if (authState.league == 'Or') leagueColor = Colors.amber;
    if (authState.league == 'Argent') leagueColor = const Color(0xFFC0C0C0);
    if (authState.league == 'Bronze') leagueColor = const Color(0xFFCD7F32);

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
                  authState.effectiveDisplayName,
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
                        'Ligue ${authState.league}',
                        style: TextStyle(
                          color: leagueColor,
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '${authState.weeklyPoints} pts hebdo',
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
          if (authState.isGuest)
            OutlinedButton(
              onPressed: () => _showLogin(context),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: Colors.cyanAccent),
                foregroundColor: Colors.cyanAccent,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              child: const Text('CONNEXION', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
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
            Icon(Icons.arrow_forward_ios, color: Colors.white38, size: 16),
          ],
        ),
      ),
    );
  }
}
