import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_theme.dart';
import '../models/rowing_metrics.dart';
import '../services/ble_ftms_service.dart';

class BleScannerSheet extends ConsumerStatefulWidget {
  const BleScannerSheet({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const BleScannerSheet(),
    );
  }

  @override
  ConsumerState<BleScannerSheet> createState() => _BleScannerSheetState();
}

class _BleScannerSheetState extends ConsumerState<BleScannerSheet> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(bleFtmsServiceProvider).startScan();
    });
  }

  @override
  Widget build(BuildContext context) {
    final bleService = ref.watch(bleFtmsServiceProvider);
    final statusStream = ref.watch(bleFtmsServiceProvider).statusStream;

    return StreamBuilder<BleConnectionStatus>(
      stream: statusStream,
      initialData: bleService.currentStatus,
      builder: (context, statusSnap) {
        final status = statusSnap.data ?? BleConnectionStatus.disconnected;

        return Container(
          height: MediaQuery.of(context).size.height * 0.65,
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            boxShadow: [
              BoxShadow(
                color: Color(0x6600F0FF),
                blurRadius: 20,
                offset: Offset(0, -4),
              ),
            ],
          ),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Poignée de glissement
              Center(
                child: Container(
                  width: 44,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.cyan.withOpacity(0.4),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Connexion Rameur BLE FTMS',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                      color: AppColors.cyan,
                    ),
                  ),
                  if (status == BleConnectionStatus.scanning)
                    const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2.2, color: AppColors.cyan),
                    )
                  else
                    IconButton(
                      icon: const Icon(Icons.refresh, color: AppColors.cyan),
                      onPressed: () => bleService.startScan(),
                    ),
                ],
              ),
              const SizedBox(height: 4),
              const Text(
                'Compatible Concept2 PM5, WaterRower, Merach, Domyos, Skillrow...',
                style: TextStyle(fontSize: 12, color: AppColors.textMuted),
              ),
              const SizedBox(height: 16),

              // Reconnexion rapide 1-tap si un rameur a déjà été connecté
              FutureBuilder<String?>(
                future: ref.read(bleFtmsServiceProvider).reconnectLastDevice().then((_) => null),
                builder: (context, _) => const SizedBox.shrink(),
              ),

              Expanded(
                child: StreamBuilder<List<ScanResult>>(
                  stream: bleService.scanResultsStream,
                  builder: (context, snap) {
                    final results = snap.data ?? [];

                    if (status == BleConnectionStatus.connecting) {
                      return const Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            CircularProgressIndicator(color: AppColors.cyan),
                            SizedBox(height: 16),
                            Text('Connexion et initialisation FTMS en cours...'),
                          ],
                        ),
                      );
                    }

                    if (results.isEmpty) {
                      return Center(
                        child: Text(
                          status == BleConnectionStatus.scanning
                              ? 'Recherche de rameurs Bluetooth en cours...'
                              : 'Aucun rameur détecté à proximité.',
                          style: const TextStyle(color: AppColors.textMuted),
                        ),
                      );
                    }

                    return ListView.separated(
                      itemCount: results.length,
                      separatorBuilder: (_, __) => const Divider(color: AppColors.cardBorder),
                      itemBuilder: (context, index) {
                        final r = results[index];
                        final name = r.device.platformName.isNotEmpty
                            ? r.device.platformName
                            : (r.advertisementData.advName.isNotEmpty
                                ? r.advertisementData.advName
                                : 'Rameur inconnu');

                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(
                            backgroundColor: AppColors.surfaceLight,
                            child: Icon(Icons.fitness_center, color: AppColors.cyan),
                          ),
                          title: Text(
                            name,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          subtitle: Text(
                            'Signal: ${r.rssi} dBm · ${r.device.remoteId.str}',
                            style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                          ),
                          trailing: ElevatedButton(
                            style: ElevatedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                            ),
                            onPressed: () async {
                              final success = await bleService.connectToDevice(r.device);
                              if (context.mounted && success) {
                                Navigator.of(context).pop();
                              }
                            },
                            child: const Text('Connecter', style: TextStyle(fontSize: 12)),
                          ),
                        );
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
