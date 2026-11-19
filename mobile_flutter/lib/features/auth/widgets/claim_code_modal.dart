import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_theme.dart';
import '../controllers/auth_controller.dart';

class ClaimCodeModal extends ConsumerStatefulWidget {
  const ClaimCodeModal({super.key});

  static Future<Map<String, dynamic>?> show(BuildContext context) {
    return showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const ClaimCodeModal(),
    );
  }

  @override
  ConsumerState<ClaimCodeModal> createState() => _ClaimCodeModalState();
}

class _ClaimCodeModalState extends ConsumerState<ClaimCodeModal> {
  final _codeController = TextEditingController();
  final _pseudoController = TextEditingController();

  bool _isLoading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _codeController.dispose();
    _pseudoController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _codeController.text.trim().toUpperCase();
    final pseudo = _pseudoController.text.trim();

    if (code.length != 5) {
      setState(() => _errorMessage = 'Le code doit comporter exactement 5 caractères.');
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final res = await ref.read(authControllerProvider.notifier).claimSessionCode(
            code,
            customPseudo: pseudo.isNotEmpty ? pseudo : null,
          );
      if (mounted) Navigator.of(context).pop(res);
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString().replaceAll('Exception:', '').trim();
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Rejoindre avec un Code',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: AppColors.cyan,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'Saisissez le code à 5 caractères du salon privé ou de votre session.',
              style: TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
            const SizedBox(height: 20),

            Center(
              child: SizedBox(
                width: 220,
                child: TextField(
                  controller: _codeController,
                  textAlign: TextAlign.center,
                  maxLength: 5,
                  textCapitalization: TextCapitalization.characters,
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[a-zA-Z0-9]')),
                  ],
                  style: const TextStyle(
                    fontSize: 32,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 10,
                    color: AppColors.yellow,
                  ),
                  decoration: InputDecoration(
                    counterText: '',
                    hintText: '•••••',
                    hintStyle: TextStyle(color: AppColors.cyan.withOpacity(0.3)),
                    filled: true,
                    fillColor: AppColors.surfaceLight,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: const BorderSide(color: AppColors.cyan, width: 2),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),

            TextField(
              controller: _pseudoController,
              decoration: InputDecoration(
                labelText: 'Votre pseudo (facultatif si déjà connecté)',
                filled: true,
                fillColor: AppColors.surfaceLight,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
            const SizedBox(height: 12),

            if (_errorMessage != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(
                  _errorMessage!,
                  style: const TextStyle(color: AppColors.red, fontSize: 13),
                ),
              ),

            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: _isLoading ? null : _submit,
                child: _isLoading
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2.2, color: AppColors.background),
                      )
                    : const Text('Rejoindre le salon'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
