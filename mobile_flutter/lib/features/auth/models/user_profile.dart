enum LeagueTier {
  bronze,
  silver,
  gold,
  diamond;

  String get displayName {
    switch (this) {
      case LeagueTier.bronze:
        return 'Bronze';
      case LeagueTier.silver:
        return 'Argent';
      case LeagueTier.gold:
        return 'Or';
      case LeagueTier.diamond:
        return 'Diamant';
    }
  }

  String get badgeEmoji {
    switch (this) {
      case LeagueTier.bronze:
        return '🥉';
      case LeagueTier.silver:
        return '🥈';
      case LeagueTier.gold:
        return '🥇';
      case LeagueTier.diamond:
        return '💎';
    }
  }

  static LeagueTier fromString(String? val) {
    final clean = (val ?? '').toUpperCase();
    if (clean.contains('DIAMOND') || clean.contains('DIAMANT')) return LeagueTier.diamond;
    if (clean.contains('GOLD') || clean.contains('OR')) return LeagueTier.gold;
    if (clean.contains('SILVER') || clean.contains('ARGENT')) return LeagueTier.silver;
    return LeagueTier.bronze;
  }
}

class UserProfile {
  final String id;
  final String login;
  final String name;
  final String email;
  final LeagueTier league;
  final int leaguePoints;
  final int totalRaces;
  final int totalWins;
  final int podiums;
  final bool isSubscriber;
  final bool isAdmin;
  final String? deviceToken;

  const UserProfile({
    required this.id,
    required this.login,
    required this.name,
    this.email = '',
    this.league = LeagueTier.bronze,
    this.leaguePoints = 0,
    this.totalRaces = 0,
    this.totalWins = 0,
    this.podiums = 0,
    this.isSubscriber = false,
    this.isAdmin = false,
    this.deviceToken,
  });

  /// Nom d'affichage prioritaire (login du compte sans jamais d'ID technique)
  String get displayPseudo => login.isNotEmpty ? login : name;

  factory UserProfile.fromMap(Map<String, dynamic> map, {String? deviceToken}) {
    final userMap = map['user'] is Map ? Map<String, dynamic>.from(map['user'] as Map) : map;

    final rawLogin = userMap['login']?.toString() ?? userMap['id']?.toString() ?? '';
    final rawName = userMap['name']?.toString() ?? rawLogin;
    final rawLeague = userMap['currentLeague']?.toString() ?? userMap['league']?.toString();
    final pts = userMap['points'] is num ? (userMap['points'] as num).toInt() : 0;

    return UserProfile(
      id: userMap['id']?.toString() ?? rawLogin,
      login: rawLogin,
      name: rawName,
      email: userMap['email']?.toString() ?? '',
      league: LeagueTier.fromString(rawLeague),
      leaguePoints: pts,
      totalRaces: userMap['totalRaces'] is num ? (userMap['totalRaces'] as num).toInt() : 0,
      totalWins: userMap['totalWins'] is num ? (userMap['totalWins'] as num).toInt() : 0,
      podiums: userMap['podiums'] is num ? (userMap['podiums'] as num).toInt() : 0,
      isSubscriber: userMap['isSubscriber'] == true,
      isAdmin: userMap['isAdmin'] == true,
      deviceToken: deviceToken ?? userMap['deviceToken']?.toString(),
    );
  }
}
