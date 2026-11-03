import Toybox.System;
import Toybox.Lang;

module I18n {

    // Identifiants internes
    const LANG_FR = 0;
    const LANG_EN = 1;
    const LANG_DE = 2;
    const LANG_ES = 3;
    const LANG_IT = 4;
    const LANG_PT = 5;

    var _currentLang as Number = LANG_EN;
    var _initialized as Boolean = false;

    function init() as Void {
        if (_initialized) {
            return;
        }
        _currentLang = detectLanguage();
        _initialized = true;
    }

    function detectLanguage() as Number {
        try {
            var dev = System.getDeviceSettings();
            if (dev has :systemLanguage) {
                var lang = dev.systemLanguage;
                if (lang == System.LANGUAGE_FRE) {
                    return LANG_FR;
                } else if (lang == System.LANGUAGE_DEU) {
                    return LANG_DE;
                } else if (lang == System.LANGUAGE_SPA) {
                    return LANG_ES;
                } else if (lang == System.LANGUAGE_ITA) {
                    return LANG_IT;
                } else if (lang == System.LANGUAGE_POR) {
                    return LANG_PT;
                }
            }
        } catch (ex) {
            // Fallback
        }
        return LANG_EN;
    }

    function getText(key as String) as String {
        if (!_initialized) {
            init();
        }

        if (key.equals("APP_NAME")) {
            return "Rower Race";
        }

        // --- SCANNING SCREEN ---
        if (key.equals("BLE_SCANNING")) {
            if (_currentLang == LANG_FR) { return "Recherche FTMS..."; }
            if (_currentLang == LANG_DE) { return "Suche FTMS..."; }
            if (_currentLang == LANG_ES) { return "Buscando FTMS..."; }
            if (_currentLang == LANG_IT) { return "Ricerca FTMS..."; }
            if (_currentLang == LANG_PT) { return "Procurando FTMS..."; }
            return "Scanning FTMS...";
        }
        if (key.equals("BLE_SYNC_ROWER")) {
            if (_currentLang == LANG_FR) { return "Synchronisation BLE Rameur..."; }
            if (_currentLang == LANG_DE) { return "BLE-Synchronisierung..."; }
            if (_currentLang == LANG_ES) { return "Sincronizando remo BLE..."; }
            if (_currentLang == LANG_IT) { return "Sincronizzazione remo BLE..."; }
            if (_currentLang == LANG_PT) { return "Sincronizando remo BLE..."; }
            return "Syncing BLE Rower...";
        }
        if (key.equals("PLAYER_LABEL")) {
            if (_currentLang == LANG_FR) { return "Joueur"; }
            if (_currentLang == LANG_DE) { return "Spieler"; }
            if (_currentLang == LANG_ES) { return "Jugador"; }
            if (_currentLang == LANG_IT) { return "Giocatore"; }
            if (_currentLang == LANG_PT) { return "Jogador"; }
            return "Player";
        }

        // --- LOBBY & WAITING ROOM ---
        if (key.equals("LOBBY_TITLE")) {
            if (_currentLang == LANG_FR) { return "PROCHAINE COURSE DANS"; }
            if (_currentLang == LANG_DE) { return "NÄCHSTES RENNEN IN"; }
            if (_currentLang == LANG_ES) { return "PRÓXIMA CARRERA EN"; }
            if (_currentLang == LANG_IT) { return "PROSSIMA GARA TRA"; }
            if (_currentLang == LANG_PT) { return "PRÓXIMA CORRIDA EM"; }
            return "NEXT RACE IN";
        }
        if (key.equals("WAITING_TITLE")) {
            if (_currentLang == LANG_FR) { return "DEPART PROCHAINE COURSE"; }
            if (_currentLang == LANG_DE) { return "START NÄCHSTES RENNEN"; }
            if (_currentLang == LANG_ES) { return "SALIDA PRÓXIMA CARRERA"; }
            if (_currentLang == LANG_IT) { return "PARTENZA PROSSIMA GARA"; }
            if (_currentLang == LANG_PT) { return "LARGADA PRÓXIMA CORRIDA"; }
            return "NEXT RACE START";
        }
        if (key.equals("START_IMM")) {
            if (_currentLang == LANG_FR) { return "DEPART IMMINENT"; }
            if (_currentLang == LANG_DE) { return "START STEHT BEVOR"; }
            if (_currentLang == LANG_ES) { return "SALIDA INMINENTE"; }
            if (_currentLang == LANG_IT) { return "PARTENZA IMMINENTE"; }
            if (_currentLang == LANG_PT) { return "LARGADA IMINENTE"; }
            return "START IMMINENT";
        }
        if (key.equals("GET_READY")) {
            if (_currentLang == LANG_FR) { return "A VOS RAMES !"; }
            if (_currentLang == LANG_DE) { return "AN DIE RUDER !"; }
            if (_currentLang == LANG_ES) { return "¡A REMAR!"; }
            if (_currentLang == LANG_IT) { return "PRONTI A REMARE !"; }
            if (_currentLang == LANG_PT) { return "AOS REMOS !"; }
            return "GET READY TO ROW !";
        }
        if (key.equals("CONNECTED_WAITING")) {
            if (_currentLang == LANG_FR) { return "Connectes en attente"; }
            if (_currentLang == LANG_DE) { return "Wartende Ruderer"; }
            if (_currentLang == LANG_ES) { return "Conectados en espera"; }
            if (_currentLang == LANG_IT) { return "Connessi in attesa"; }
            if (_currentLang == LANG_PT) { return "Conectados aguardando"; }
            return "Connected waiting";
        }
        if (key.equals("TARGET_DIST")) {
            if (_currentLang == LANG_FR) { return "Distance cible"; }
            if (_currentLang == LANG_DE) { return "Zieldistanz"; }
            if (_currentLang == LANG_ES) { return "Distancia objetivo"; }
            if (_currentLang == LANG_IT) { return "Distanza obiettivo"; }
            if (_currentLang == LANG_PT) { return "Distância alvo"; }
            return "Target distance";
        }
        if (key.equals("BTN_JOIN_RACE")) {
            if (_currentLang == LANG_FR) { return "START : Rejoindre Course"; }
            if (_currentLang == LANG_DE) { return "START : Rennen beitreten"; }
            if (_currentLang == LANG_ES) { return "START : Unirse Carrera"; }
            if (_currentLang == LANG_IT) { return "START : Unisciti Gara"; }
            if (_currentLang == LANG_PT) { return "START : Entrar Corrida"; }
            return "START : Join Race";
        }
        if (key.equals("BTN_ROW_SOLO")) {
            if (_currentLang == LANG_FR) { return "DOWN : Ramer en Solo"; }
            if (_currentLang == LANG_DE) { return "DOWN : Solo rudern"; }
            if (_currentLang == LANG_ES) { return "DOWN : Remar en Solo"; }
            if (_currentLang == LANG_IT) { return "DOWN : Rema da Solo"; }
            if (_currentLang == LANG_PT) { return "DOWN : Remar Solo"; }
            return "DOWN : Row Solo";
        }
        if (key.equals("BTN_VS_BOTS")) {
            if (_currentLang == LANG_FR) { return "START : Jouer vs Bots ?"; }
            if (_currentLang == LANG_DE) { return "START : Gegen Bots ?"; }
            if (_currentLang == LANG_ES) { return "START : ¿Jugar vs Bots?"; }
            if (_currentLang == LANG_IT) { return "START : Sfida i Bot ?"; }
            if (_currentLang == LANG_PT) { return "START : Jogar vs Bots ?"; }
            return "START : Play vs Bots ?";
        }
        if (key.equals("AUTO_START_AT_ZERO")) {
            if (_currentLang == LANG_FR) { return "Depart automatique a 00:00"; }
            if (_currentLang == LANG_DE) { return "Automatischer Start bei 00:00"; }
            if (_currentLang == LANG_ES) { return "Salida automática a las 00:00"; }
            if (_currentLang == LANG_IT) { return "Partenza automatica a 00:00"; }
            if (_currentLang == LANG_PT) { return "Largada automática às 00:00"; }
            return "Auto start at 00:00";
        }

        // --- CAREER STATS ---
        if (key.equals("CAREER_RANK")) {
            if (_currentLang == LANG_FR) { return "CLT GEN"; }
            if (_currentLang == LANG_DE) { return "GES-RANG"; }
            if (_currentLang == LANG_ES) { return "CLAS GEN"; }
            if (_currentLang == LANG_IT) { return "CLASS GEN"; }
            if (_currentLang == LANG_PT) { return "CLASS GERAL"; }
            return "GEN RANK";
        }
        if (key.equals("STAT_LAST")) {
            if (_currentLang == LANG_FR) { return "Dernier"; }
            if (_currentLang == LANG_DE) { return "Letztes"; }
            if (_currentLang == LANG_ES) { return "Último"; }
            if (_currentLang == LANG_IT) { return "Ultimo"; }
            if (_currentLang == LANG_PT) { return "Último"; }
            return "Last";
        }
        if (key.equals("STAT_RECORD")) {
            if (_currentLang == LANG_FR) { return "Record"; }
            if (_currentLang == LANG_DE) { return "Rekord"; }
            if (_currentLang == LANG_ES) { return "Récord"; }
            if (_currentLang == LANG_IT) { return "Record"; }
            if (_currentLang == LANG_PT) { return "Recorde"; }
            return "Best";
        }

        // --- RACING HUD ---
        if (key.equals("HUD_RANK")) {
            if (_currentLang == LANG_FR) { return "RANG"; }
            if (_currentLang == LANG_DE) { return "RANG"; }
            if (_currentLang == LANG_ES) { return "PUESTO"; }
            if (_currentLang == LANG_IT) { return "POS"; }
            if (_currentLang == LANG_PT) { return "POS"; }
            return "RANK";
        }
        if (key.equals("HUD_LEADER")) {
            if (_currentLang == LANG_FR) { return "1er"; }
            if (_currentLang == LANG_DE) { return "1."; }
            if (_currentLang == LANG_ES) { return "1ro"; }
            if (_currentLang == LANG_IT) { return "1°"; }
            if (_currentLang == LANG_PT) { return "1°"; }
            return "1st";
        }
        if (key.equals("HUD_PREV")) {
            if (_currentLang == LANG_FR) { return "PREC:"; }
            if (_currentLang == LANG_DE) { return "VOR:"; }
            if (_currentLang == LANG_ES) { return "ANT:"; }
            if (_currentLang == LANG_IT) { return "PREC:"; }
            if (_currentLang == LANG_PT) { return "ANT:"; }
            return "PREV:";
        }
        if (key.equals("HUD_NEXT")) {
            if (_currentLang == LANG_FR) { return "SUIV:"; }
            if (_currentLang == LANG_DE) { return "NACH:"; }
            if (_currentLang == LANG_ES) { return "SIG:"; }
            if (_currentLang == LANG_IT) { return "SUCC:"; }
            if (_currentLang == LANG_PT) { return "PROX:"; }
            return "NEXT:";
        }
        if (key.equals("HUD_CADENCE")) {
            if (_currentLang == LANG_FR) { return "CADENCE SPM"; }
            if (_currentLang == LANG_DE) { return "SCHLAGZAHL SPM"; }
            if (_currentLang == LANG_ES) { return "CADENCIA SPM"; }
            if (_currentLang == LANG_IT) { return "CADENZA SPM"; }
            if (_currentLang == LANG_PT) { return "CADÊNCIA SPM"; }
            return "STROKE RATE SPM";
        }
        if (key.equals("HUD_POWER")) {
            if (_currentLang == LANG_FR) { return "PUISSANCE"; }
            if (_currentLang == LANG_DE) { return "LEISTUNG"; }
            if (_currentLang == LANG_ES) { return "POTENCIA"; }
            if (_currentLang == LANG_IT) { return "POTENZA"; }
            if (_currentLang == LANG_PT) { return "POTÊNCIA"; }
            return "POWER";
        }
        if (key.equals("HUD_PACE")) {
            if (_currentLang == LANG_FR) { return "ALLURE"; }
            if (_currentLang == LANG_DE) { return "PACE"; }
            if (_currentLang == LANG_ES) { return "RITMO"; }
            if (_currentLang == LANG_IT) { return "ANDATURA"; }
            if (_currentLang == LANG_PT) { return "RITMO"; }
            return "PACE";
        }

        // --- WARNING & PENALTY ---
        if (key.equals("WARN_NO_ROW")) {
            if (_currentLang == LANG_FR) { return "Ne pas ramer"; }
            if (_currentLang == LANG_DE) { return "Nicht rudern"; }
            if (_currentLang == LANG_ES) { return "No remar"; }
            if (_currentLang == LANG_IT) { return "Non remare"; }
            if (_currentLang == LANG_PT) { return "Não remar"; }
            return "Do not row";
        }
        if (key.equals("WARN_ZERO_SPEED")) {
            if (_currentLang == LANG_FR) { return "Vitesse a 0 requise !"; }
            if (_currentLang == LANG_DE) { return "Geschwindigkeit 0 erforderlich !"; }
            if (_currentLang == LANG_ES) { return "¡Velocidad a 0 requerida!"; }
            if (_currentLang == LANG_IT) { return "Velocità a 0 richiesta !"; }
            if (_currentLang == LANG_PT) { return "Velocidade a 0 necessária !"; }
            return "Speed to 0 required !";
        }
        if (key.equals("WARN_WAIT_START")) {
            if (_currentLang == LANG_FR) { return "Attendez le départ !"; }
            if (_currentLang == LANG_DE) { return "Warten auf den Start !"; }
            if (_currentLang == LANG_ES) { return "¡Espere la salida!"; }
            if (_currentLang == LANG_IT) { return "Attendi la partenza !"; }
            if (_currentLang == LANG_PT) { return "Aguarde a largada !"; }
            return "Wait for start !";
        }

        // --- PAUSE & FINISH ---
        if (key.equals("PAUSED_TITLE")) {
            if (_currentLang == LANG_FR) { return "EN PAUSE"; }
            if (_currentLang == LANG_DE) { return "PAUSE"; }
            if (_currentLang == LANG_ES) { return "EN PAUSA"; }
            if (_currentLang == LANG_IT) { return "IN PAUSA"; }
            if (_currentLang == LANG_PT) { return "EM PAUSA"; }
            return "PAUSED";
        }
        if (key.equals("MENU_RESUME")) {
            if (_currentLang == LANG_FR) { return "Reprendre"; }
            if (_currentLang == LANG_DE) { return "Fortsetzen"; }
            if (_currentLang == LANG_ES) { return "Reanudar"; }
            if (_currentLang == LANG_IT) { return "Riprendi"; }
            if (_currentLang == LANG_PT) { return "Continuar"; }
            return "Resume";
        }
        if (key.equals("MENU_SAVE_EXIT")) {
            if (_currentLang == LANG_FR) { return "Enregistrer & Quitter"; }
            if (_currentLang == LANG_DE) { return "Speichern & Beenden"; }
            if (_currentLang == LANG_ES) { return "Guardar y Salir"; }
            if (_currentLang == LANG_IT) { return "Salva ed Esci"; }
            if (_currentLang == LANG_PT) { return "Salvar e Sair"; }
            return "Save & Exit";
        }
        if (key.equals("MENU_ABANDON")) {
            if (_currentLang == LANG_FR) { return "Abandonner"; }
            if (_currentLang == LANG_DE) { return "Aufgeben"; }
            if (_currentLang == LANG_ES) { return "Abandonar"; }
            if (_currentLang == LANG_IT) { return "Abbandona"; }
            if (_currentLang == LANG_PT) { return "Abandonar"; }
            return "Abandon";
        }
        if (key.equals("FINISHED_TITLE")) {
            if (_currentLang == LANG_FR) { return "COURSE TERMINEE"; }
            if (_currentLang == LANG_DE) { return "RENNEN BEENDET"; }
            if (_currentLang == LANG_ES) { return "CARRERA TERMINADA"; }
            if (_currentLang == LANG_IT) { return "GARA TERMINATA"; }
            if (_currentLang == LANG_PT) { return "CORRIDA TERMINADA"; }
            return "RACE FINISHED";
        }
        if (key.equals("YOUR_RANK")) {
            if (_currentLang == LANG_FR) { return "Votre Rang"; }
            if (_currentLang == LANG_DE) { return "Ihr Rang"; }
            if (_currentLang == LANG_ES) { return "Tu Puesto"; }
            if (_currentLang == LANG_IT) { return "Tua Posizione"; }
            if (_currentLang == LANG_PT) { return "Sua Posição"; }
            return "Your Rank";
        }
        if (key.equals("PODIUM_OFFICIAL")) {
            if (_currentLang == LANG_FR) { return "--- PODIUM OFFICIEL ---"; }
            if (_currentLang == LANG_DE) { return "--- OFFIZIELLES PODIUM ---"; }
            if (_currentLang == LANG_ES) { return "--- PODIO OFICIAL ---"; }
            if (_currentLang == LANG_IT) { return "--- PODIO UFFICIALE ---"; }
            if (_currentLang == LANG_PT) { return "--- PÓDIO OFICIAL ---"; }
            return "--- OFFICIAL PODIUM ---";
        }

        // --- LATE ARRIVAL SELECTION ---
        if (key.equals("LATE_TITLE")) {
            if (_currentLang == LANG_FR) { return "COURSE EN COURS"; }
            if (_currentLang == LANG_DE) { return "RENNEN LÄUFT BEREITS"; }
            if (_currentLang == LANG_ES) { return "CARRERA EN CURSO"; }
            if (_currentLang == LANG_IT) { return "GARA IN CORSO"; }
            if (_currentLang == LANG_PT) { return "CORRIDA EM ANDAMENTO"; }
            return "RACE IN PROGRESS";
        }
        if (key.equals("LATE_OPT_JOIN")) {
            if (_currentLang == LANG_FR) { return "START : Rejoindre Course"; }
            if (_currentLang == LANG_DE) { return "START : Jetzt beitreten"; }
            if (_currentLang == LANG_ES) { return "START : Unirse a Carrera"; }
            if (_currentLang == LANG_IT) { return "START : Unisciti alla Gara"; }
            if (_currentLang == LANG_PT) { return "START : Entrar na Corrida"; }
            return "START : Join Race";
        }
        if (key.equals("LATE_OPT_WAIT")) {
            if (_currentLang == LANG_FR) { return "DOWN : Attendre Prochaine"; }
            if (_currentLang == LANG_DE) { return "DOWN : Auf Nächstes warten"; }
            if (_currentLang == LANG_ES) { return "DOWN : Esperar Próxima"; }
            if (_currentLang == LANG_IT) { return "DOWN : Attendi Prossima"; }
            if (_currentLang == LANG_PT) { return "DOWN : Aguardar Próxima"; }
            return "DOWN : Wait Next Race";
        }

        // --- BOTS PROMPT ---
        if (key.equals("BOTS_PROMPT_TITLE")) {
            if (_currentLang == LANG_FR) { return "VOUS ETES SEUL"; }
            if (_currentLang == LANG_DE) { return "SIE SIND ALLEIN"; }
            if (_currentLang == LANG_ES) { return "ESTÁS SOLO"; }
            if (_currentLang == LANG_IT) { return "SEI DA SOLO"; }
            if (_currentLang == LANG_PT) { return "VOCÊ ESTÁ SOZINHO"; }
            return "YOU ARE ALONE";
        }
        if (key.equals("BOTS_PROMPT_QUESTION")) {
            if (_currentLang == LANG_FR) { return "Affronter des bots ?"; }
            if (_currentLang == LANG_DE) { return "Gegen virtuelle Bots ?"; }
            if (_currentLang == LANG_ES) { return "¿Competir vs bots?"; }
            if (_currentLang == LANG_IT) { return "Gareggia contro i bot ?"; }
            if (_currentLang == LANG_PT) { return "Enfrentar bots virtuais ?"; }
            return "Compete against bots ?";
        }
        if (key.equals("BTN_YES_BOTS")) {
            if (_currentLang == LANG_FR) { return "START : Oui, avec des bots"; }
            if (_currentLang == LANG_DE) { return "START : Ja, mit Bots"; }
            if (_currentLang == LANG_ES) { return "START : Sí, con bots"; }
            if (_currentLang == LANG_IT) { return "START : Sì, con i bot"; }
            if (_currentLang == LANG_PT) { return "START : Sim, com bots"; }
            return "START : Yes, with bots";
        }
        if (key.equals("BTN_NO_SOLO")) {
            if (_currentLang == LANG_FR) { return "DOWN : Non, ramer seul"; }
            if (_currentLang == LANG_DE) { return "DOWN : Nein, allein"; }
            if (_currentLang == LANG_ES) { return "DOWN : No, remar solo"; }
            if (_currentLang == LANG_IT) { return "DOWN : No, rema da solo"; }
            if (_currentLang == LANG_PT) { return "DOWN : Não, remar só"; }
            return "DOWN : No, row alone";
        }

        // --- WEB AUTH PROMPT ---
        if (key.equals("AUTH_TITLE")) {
            if (_currentLang == LANG_FR) { return "CONNEXION WEB"; }
            if (_currentLang == LANG_DE) { return "WEB-ANMELDUNG"; }
            if (_currentLang == LANG_ES) { return "CONEXIÓN WEB"; }
            if (_currentLang == LANG_IT) { return "CONNESSIONE WEB"; }
            if (_currentLang == LANG_PT) { return "CONEXÃO WEB"; }
            return "WEB LOGIN";
        }
        if (key.equals("AUTH_AUTHORIZE_PLAYER")) {
            if (_currentLang == LANG_FR) { return "Autoriser le joueur :"; }
            if (_currentLang == LANG_DE) { return "Spieler autorisieren :"; }
            if (_currentLang == LANG_ES) { return "Autorizar jugador :"; }
            if (_currentLang == LANG_IT) { return "Autorizza giocatore :"; }
            if (_currentLang == LANG_PT) { return "Autorizar jogador :"; }
            return "Authorize player :";
        }
        if (key.equals("AUTH_APPROVE")) {
            if (_currentLang == LANG_FR) { return "START : Accepter"; }
            if (_currentLang == LANG_DE) { return "START : Bestätigen"; }
            if (_currentLang == LANG_ES) { return "START : Aceptar"; }
            if (_currentLang == LANG_IT) { return "START : Accetta"; }
            if (_currentLang == LANG_PT) { return "START : Aceitar"; }
            return "START : Approve";
        }
        if (key.equals("AUTH_REJECT")) {
            if (_currentLang == LANG_FR) { return "DOWN : Refuser"; }
            if (_currentLang == LANG_DE) { return "DOWN : Ablehnen"; }
            if (_currentLang == LANG_ES) { return "DOWN : Rechazar"; }
            if (_currentLang == LANG_IT) { return "DOWN : Rifiuta"; }
            if (_currentLang == LANG_PT) { return "DOWN : Recusar"; }
            return "DOWN : Reject";
        }

        return key;
    }
}
