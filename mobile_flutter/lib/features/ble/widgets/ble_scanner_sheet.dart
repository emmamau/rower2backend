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
  String? _savedDeviceName;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      final bleService = ref.read(bleFtmsServiceProvider);
      final saved = await bleService.getSavedLastDeviceName();
      if (mounted) {
        setState(() {
          _savedDeviceName = saved;
        });
      }
      await bleService.startScan();
    });
  }

  Future<void> _connectToScanResult(BleFtmsService bleService, ScanResult r) async {
    setState(() => _errorMessage = null);
    final displayName = BleFtmsService.resolveScanResultName(r);
    final success = await bleService.connectToDevice(r.device, knownName: displayName);
    if (!mounted) return;
    if (success) {
      Navigator.of(context).pop();
    } else {
      setState(() {
        _errorMessage =
            'Échec de connexion à "$displayName". Vérifiez que la poulie SmartRow est réveillée (et déconnectée de l\'app SmartRow en mode direct) ou que le Broadcast EXR est actif.';
      });
      await bleService.startScan();
    }
  }

  Future<void> _reconnectSavedDevice(BleFtmsService bleService) async {
    setState(() => _errorMessage = null);
    final success = await bleService.reconnectLastDevice();
    if (!mounted) return;
    if (success) {
      Navigator.of(context).pop();
    } else {
      setState(() {
        _errorMessage =
            'Impossible de joindre "${_savedDeviceName ?? 'le dernier rameur'}". Sélectionnez votre rameur dans la liste ci-dessous.';
      });
      await bleService.startScan();
    }
  }

  @override
  Widget build(BuildContext context) {
    final bleService = ref.watch(bleFtmsServiceProvider);
    final statusStream = bleService.statusStream;

    return StreamBuilder<BleConnectionStatus>(
      stream: statusStream,
      initialData: bleService.currentStatus,
      builder: (context, statusSnap) {
        final status = statusSnap.data ?? BleConnectionStatus.disconnected;

        return Container(
          height: MediaQuery.of(context).size.height * 0.70,
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
                  const Expanded(
                    child: Text(
                      'Connexion Rameur BLE (SmartRow & FTMS)',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                        color: AppColors.cyan,
                      ),
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
                      onPressed: () {
                        setState(() => _errorMessage = null);
                        bleService.startScan();
                      },
                    ),
                ],
              ),
              const SizedBox(height: 4),
              const Text(
                'Compatible Poulie WaterRower SmartRow directe, Broadcast EXR, Concept2 PM5, Merach, Domyos...',
                style: TextStyle(fontSize: 12, color: AppColors.textMuted),
              ),
              const SizedBox(height: 12),

              // Bouton optionnel de reconnexion rapide 1-tap (ne bloque jamais le scan en cours)
              if (_savedDeviceName != null &&
                  status != BleConnectionStatus.connecting &&
                  status != BleConnectionStatus.connected)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.history, size: 16, color: AppColors.cyan),
                      label: Text(
                        'Reconnecter $_savedDeviceName',
                        style: const TextStyle(fontSize: 12, color: AppColors.cyan),
                      ),
                      style: OutlinedButton.styleFrom(
                        side: BorderSide(color: AppColors.cyan.withOpacity(0.5)),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      ),
                      onPressed: () => _reconnectSavedDevice(bleService),
                    ),
                  ),
                ),

              if (_errorMessage != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.redAccent.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: Colors.redAccent.withOpacity(0.5)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.error_outline, color: Colors.redAccent, size: 18),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _errorMessage!,
                          style: const TextStyle(color: Colors.white, fontSize: 11.5),
                        ),
                      ),
                    ],
                  ),
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
                            Text('Connexion et initialisation SmartRow / FTMS en cours...'),
                          ],
                        ),
                      );
                    }

                    if (results.isEmpty) {
                      return Center(
                        child: Text(
                          status == BleConnectionStatus.scanning
                              ? 'Recherche de la poulie WaterRower / rameur Bluetooth...'
                              : 'Aucun rameur détecté à proximité.\nDonnez un coup de rame pour réveiller la poulie.',
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: AppColors.textMuted),
                        ),
                      );
                    }

                    return ListView.separated(
                      itemCount: results.length,
                      separatorBuilder: (_, __) => const Divider(color: AppColors.cardBorder),
                      itemBuilder: (context, index) {
                        final r = results[index];
                        final name = BleFtmsService.resolveScanResultName(r);
                        final isSmartRowPulley = BleFtmsService.isSmartRowDirectScanResult(r);
                        final isFtmsExr = BleFtmsService.isFtmsOrExrScanResult(r);
                        final String modeLabel = isSmartRowPulley
                            ? 'Poulie SmartRow Directe'
                            : (isFtmsExr ? 'FTMS / Broadcast EXR' : 'Rameur BLE');

                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: CircleAvatar(
                            backgroundColor: AppColors.surfaceLight,
                            child: Icon(
                              isSmartRowPulley ? Icons.rowing : Icons.fitness_center,
                              color: AppColors.cyan,
                            ),
                          ),
                          title: Text(
                            name,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          subtitle: Text(
                            '$modeLabel · Signal: ${r.rssi} dBm',
                            style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                          ),
                          trailing: ElevatedButton(
                            style: ElevatedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                            ),
                            onPressed: () => _connectToScanResult(bleService, r),
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
