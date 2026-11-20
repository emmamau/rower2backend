/// Dictionnaire de chaînes multilingues pour RowerRace Mobile (FR / EN).
class AppStrings {
  static const Map<String, Map<String, String>> _localizedValues = {
    'fr': {
      // General
      'app_title': 'RowerRace',
      'app_subtitle': 'Passerelle BLE FTMS & Régate Temps Réel',
      'loading': 'Chargement...',
      'btn_confirm': 'Valider',
      'btn_cancel': 'Annuler',
      'btn_close': 'Fermer',
      'btn_save': 'Enregistrer',
      'btn_retry': 'Réessayer',
      'language': 'Langue',
      'french': 'Français',
      'english': 'English',

      // Home Screen
      'btn_start_race': 'REJOINDRE LA RÉGATE',
      'btn_ble_scan': 'Rechercher un Rameur FTMS',
      'ble_connected': 'Rameur Connecté',
      'ble_disconnected': 'Non connecté',
      'ble_connecting': 'Connexion en cours...',
      'status_ready': 'PRÊT POUR LA COURSE',
      'status_not_ready': 'EN ATTENTE DU RAMEUR',
      'field_pseudo': 'Pseudo Rameur',
      'field_pin': 'Code Appairage / PIN',
      'btn_claim_code': 'Associer code PIN',
      'account_title': 'Compte',
      'login': 'Connexion',
      'logout': 'Déconnexion',
      'logged_in_as': 'Connecté en tant que',
      'guest_mode': 'Mode Invité',

      // Modals
      'login_title': 'Connexion Compte',
      'login_desc': 'Connectez-vous pour retrouver votre profil et vos salons.',
      'login_field_username': 'Nom d\'utilisateur ou Email',
      'login_field_password': 'Mot de passe',
      'login_btn_submit': 'Se connecter',
      'claim_title': 'Associer ma montre / mon couloir',
      'claim_desc': 'Entrez le code PIN à 4 chiffres affiché sur votre montre Garmin pour lier votre rameur à votre couloir de course.',
      'claim_pin_hint': 'Ex: 4821',
      'claim_btn_submit': 'Associer le couloir',

      // Race & HUD
      'hud_split': 'TEMPS / 500m',
      'hud_watts': 'PUISSANCE (W)',
      'hud_spm': 'CADENCE (SPM)',
      'hud_hr': 'CARDIO (BPM)',
      'hud_distance': 'DISTANCE',
      'hud_rank': 'CLASSEMENT',
      'false_start_title': 'FAUX DÉPART DÉTECTÉ',
      'false_start_msg': 'Pénalité de 5 secondes appliquée au départ.',
      'podium_title': 'COURSE TERMINÉE !',
      'podium_rank_1': '1ère Place 🏆',
      'podium_rank_2': '2ème Place 🥈',
      'podium_rank_3': '3ème Place 🥉',
      'podium_rank_suffix': 'ème Place',
      'btn_exit_race': 'Quitter la régate',
      'btn_race_again': 'Rejouer',
      'lane_label': 'Couloir',
    },
    'en': {
      // General
      'app_title': 'RowerRace',
      'app_subtitle': 'BLE FTMS Gateway & Real-Time Regatta',
      'loading': 'Loading...',
      'btn_confirm': 'Confirm',
      'btn_cancel': 'Cancel',
      'btn_close': 'Close',
      'btn_save': 'Save',
      'btn_retry': 'Retry',
      'language': 'Language',
      'french': 'Français',
      'english': 'English',

      // Home Screen
      'btn_start_race': 'JOIN REGATTA',
      'btn_ble_scan': 'Scan for FTMS Rower',
      'ble_connected': 'Rower Connected',
      'ble_disconnected': 'Disconnected',
      'ble_connecting': 'Connecting...',
      'status_ready': 'READY TO RACE',
      'status_not_ready': 'WAITING FOR ROWER',
      'field_pseudo': 'Rower Nickname',
      'field_pin': 'Pairing Code / PIN',
      'btn_claim_code': 'Pair PIN Code',
      'account_title': 'Account',
      'login': 'Log In',
      'logout': 'Log Out',
      'logged_in_as': 'Logged in as',
      'guest_mode': 'Guest Mode',

      // Modals
      'login_title': 'Account Login',
      'login_desc': 'Log in to access your profile and private rooms.',
      'login_field_username': 'Username or Email',
      'login_field_password': 'Password',
      'login_btn_submit': 'Log In',
      'claim_title': 'Pair Watch / Lane',
      'claim_desc': 'Enter the 4-digit PIN code shown on your Garmin watch to link your rower to your race lane.',
      'claim_pin_hint': 'E.g., 4821',
      'claim_btn_submit': 'Link Lane',

      // Race & HUD
      'hud_split': 'PACE / 500m',
      'hud_watts': 'POWER (W)',
      'hud_spm': 'CADENCE (SPM)',
      'hud_hr': 'HEART RATE (BPM)',
      'hud_distance': 'DISTANCE',
      'hud_rank': 'RANK',
      'false_start_title': 'FALSE START DETECTED',
      'false_start_msg': '5-second penalty applied at race start.',
      'podium_title': 'RACE FINISHED!',
      'podium_rank_1': '1st Place 🏆',
      'podium_rank_2': '2nd Place 🥈',
      'podium_rank_3': '3rd Place 🥉',
      'podium_rank_suffix': 'th Place',
      'btn_exit_race': 'Leave Regatta',
      'btn_race_again': 'Race Again',
      'lane_label': 'Lane',
    },
  };

  static String get(String key, String languageCode) {
    final lang = _localizedValues.containsKey(languageCode) ? languageCode : 'en';
    return _localizedValues[lang]?[key] ?? _localizedValues['en']?[key] ?? key;
  }
}
