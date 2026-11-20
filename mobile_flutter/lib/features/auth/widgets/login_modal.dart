import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/i18n_service.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../controllers/auth_controller.dart';

class LoginModal extends ConsumerStatefulWidget {
  const LoginModal({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const LoginModal(),
    );
  }

  @override
  ConsumerState<LoginModal> createState() => _LoginModalState();
}

class _LoginModalState extends ConsumerState<LoginModal> {
  final _loginController = TextEditingController();
  final _passwordController = TextEditingController();
  final _urlController = TextEditingController();

  bool _isLoading = false;
  bool _showSettings = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    ref.read(apiClientProvider).getEffectiveBaseUrl().then((url) {
      if (mounted) _urlController.text = url;
    });
  }

  @override
  void dispose() {
    _loginController.dispose();
    _passwordController.dispose();
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final login = _loginController.text.trim();
    final password = _passwordController.text;

    if (login.isEmpty || password.isEmpty) {
      final isFr = ref.read(i18nProvider) == 'fr';
      setState(() => _errorMessage = isFr
          ? 'Veuillez saisir votre login et mot de passe.'
          : 'Please enter your username and password.');
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      if (_showSettings && _urlController.text.trim().isNotEmpty) {
        await ref.read(apiClientProvider).updateBaseUrl(_urlController.text.trim());
      }

      await ref.read(authControllerProvider.notifier).login(login, password);
      if (mounted) Navigator.of(context).pop();
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
    final i18n = ref.read(i18nProvider.notifier);

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
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  i18n.t('login_title'),
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: AppColors.cyan,
                  ),
                ),
                IconButton(
                  icon: Icon(
                    _showSettings ? Icons.close : Icons.settings,
                    color: AppColors.textMuted,
                  ),
                  onPressed: () => setState(() => _showSettings = !_showSettings),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              i18n.t('login_desc'),
              style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
            const SizedBox(height: 16),

            if (_showSettings) ...[
              TextField(
                controller: _urlController,
                decoration: InputDecoration(
                  labelText: 'URL Serveur API (Render)',
                  labelStyle: const TextStyle(color: AppColors.cyan),
                  filled: true,
                  fillColor: AppColors.surfaceLight,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
              const SizedBox(height: 12),
            ],

            TextField(
              controller: _loginController,
              decoration: InputDecoration(
                labelText: i18n.t('login_field_username'),
                filled: true,
                fillColor: AppColors.surfaceLight,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
            const SizedBox(height: 12),

            TextField(
              controller: _passwordController,
              obscureText: true,
              decoration: InputDecoration(
                labelText: i18n.t('login_field_password'),
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
                    : Text(i18n.t('login_btn_submit')),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
