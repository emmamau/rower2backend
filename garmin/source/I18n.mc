import Toybox.System;
import Toybox.Lang;

module I18n {

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
        }
        return LANG_EN;
    }

    function getText(key as String) as String {
        if (!_initialized) {
            init();
        }

        if (key.equals("APP_NAME")) {
            return "ROWER RACE";
        }

        // --- G1: PRE-WORKOUT / BLE CONNECTION ---
        if (key.equals("PRE_SEARCH_TITLE")) {
            if (_currentLang == LANG_FR) { return "RECHERCHE RAMEUR"; }
            if (_currentLang == LANG_DE) { return "SUCHE RUDERGERAT"; }
            if (_currentLang == LANG_ES) { return "BUSCANDO REMO"; }
            if (_currentLang == LANG_IT) { return "RICERCA VOGATORE"; }
            if (_currentLang == LANG_PT) { return "BUSCANDO REMO"; }
            return "SEARCHING ROWER";
        }
        if (key.equals("PRE_CONNECTING")) {
            if (_currentLang == LANG_FR) { return "CONNEXION BLE..."; }
            if (_currentLang == LANG_DE) { return "VERBINDE BLE..."; }
            if (_currentLang == LANG_ES) { return "CONECTANDO BLE..."; }
            if (_currentLang == LANG_IT) { return "CONNESSIONE BLE..."; }
            if (_currentLang == LANG_PT) { return "CONECTANDO BLE..."; }
            return "CONNECTING BLE...";
        }
        if (key.equals("PRE_SEARCH_SUB")) {
            return "FTMS / SmartRow";
        }
        if (key.equals("PRE_HINT_WAKE")) {
            if (_currentLang == LANG_FR) { return "Tirez pour activer le BLE"; }
            if (_currentLang == LANG_DE) { return "Ziehen fur BLE-Start"; }
            if (_currentLang == LANG_ES) { return "Reme para activar BLE"; }
            if (_currentLang == LANG_IT) { return "Voga per attivare BLE"; }
            if (_currentLang == LANG_PT) { return "Reme para ativar BLE"; }
            return "Pull handle to wake BLE";
        }
        if (key.equals("PRE_READY_TITLE")) {
            if (_currentLang == LANG_FR) { return "RAMEUR PRET"; }
            if (_currentLang == LANG_DE) { return "RUDERER BEREIT"; }
            if (_currentLang == LANG_ES) { return "REMO LISTO"; }
            if (_currentLang == LANG_IT) { return "VOGATORE PRONTO"; }
            if (_currentLang == LANG_PT) { return "REMO PRONTO"; }
            return "ROWER READY";
        }
        if (key.equals("PRE_START_BTN")) {
            if (_currentLang == LANG_FR) { return "CONTINUER"; }
            if (_currentLang == LANG_DE) { return "WEITER"; }
            if (_currentLang == LANG_ES) { return "CONTINUAR"; }
            if (_currentLang == LANG_IT) { return "CONTINUA"; }
            if (_currentLang == LANG_PT) { return "CONTINUAR"; }
            return "CONTINUE";
        }
        if (key.equals("PRE_START_PROMPT")) {
            if (_currentLang == LANG_FR) { return "START : Menu Course"; }
            if (_currentLang == LANG_DE) { return "START : Rennmenu"; }
            if (_currentLang == LANG_ES) { return "START : Menu Carrera"; }
            if (_currentLang == LANG_IT) { return "START : Menu Gara"; }
            if (_currentLang == LANG_PT) { return "START : Menu Corrida"; }
            return "START : Race Menu";
        }

        // --- G2: MAIN MENU ---
        if (key.equals("MENU_TITLE")) {
            if (_currentLang == LANG_FR) { return "MODE DE COURSE"; }
            if (_currentLang == LANG_DE) { return "RENNMODUS"; }
            if (_currentLang == LANG_ES) { return "MODO CARRERA"; }
            if (_currentLang == LANG_IT) { return "MODALITA GARA"; }
            if (_currentLang == LANG_PT) { return "MODO CORRIDA"; }
            return "RACE MODE";
        }
        if (key.equals("MENU_ENTER_CODE")) {
            if (_currentLang == LANG_FR) { return "Entrer un code"; }
            if (_currentLang == LANG_DE) { return "Code eingeben"; }
            if (_currentLang == LANG_ES) { return "Introducir codigo"; }
            if (_currentLang == LANG_IT) { return "Inserisci codice"; }
            if (_currentLang == LANG_PT) { return "Introduzir codigo"; }
            return "Enter a code";
        }
        if (key.equals("MENU_PUBLIC")) {
            if (_currentLang == LANG_FR) { return "Course Publique"; }
            if (_currentLang == LANG_DE) { return "Offenes Rennen"; }
            if (_currentLang == LANG_ES) { return "Carrera Publica"; }
            if (_currentLang == LANG_IT) { return "Gara Pubblica"; }
            if (_currentLang == LANG_PT) { return "Corrida Publica"; }
            return "Public Race";
        }
        if (key.equals("MENU_PRIVATE")) {
            if (_currentLang == LANG_FR) { return "Rejoindre un salon"; }
            if (_currentLang == LANG_DE) { return "Raum beitreten"; }
            if (_currentLang == LANG_ES) { return "Unirse a una sala"; }
            if (_currentLang == LANG_IT) { return "Entra in una stanza"; }
            if (_currentLang == LANG_PT) { return "Entrar numa sala"; }
            return "Join a Room";
        }
        if (key.equals("MENU_SOLO")) {
            if (_currentLang == LANG_FR) { return "Ramer en Solo"; }
            if (_currentLang == LANG_DE) { return "Solo Rudern"; }
            if (_currentLang == LANG_ES) { return "Remar en Solo"; }
            if (_currentLang == LANG_IT) { return "Voga in Solitaria"; }
            if (_currentLang == LANG_PT) { return "Remar Solo"; }
            return "Row Solo";
        }
        if (key.equals("MENU_PAIR")) {
            if (_currentLang == LANG_FR) { return "Appairer la montre"; }
            if (_currentLang == LANG_DE) { return "Uhr koppeln"; }
            if (_currentLang == LANG_ES) { return "Vincular reloj"; }
            if (_currentLang == LANG_IT) { return "Associa orologio"; }
            if (_currentLang == LANG_PT) { return "Emparelhar relogio"; }
            return "Pair Watch";
        }
        if (key.equals("MENU_PAIRED")) {
            if (_currentLang == LANG_FR) { return "Statut : Appaire"; }
            if (_currentLang == LANG_DE) { return "Status: Gekoppelt"; }
            if (_currentLang == LANG_ES) { return "Estado: Vinculado"; }
            if (_currentLang == LANG_IT) { return "Stato: Associato"; }
            if (_currentLang == LANG_PT) { return "Status: Emparelhado"; }
            return "Status: Paired";
        }
        if (key.equals("MENU_RESET_PAIRING")) {
            if (_currentLang == LANG_FR) { return "Reinitialiser l'appairage"; }
            if (_currentLang == LANG_DE) { return "Kopplung zurucksetzen"; }
            if (_currentLang == LANG_ES) { return "Restablecer vinculacion"; }
            if (_currentLang == LANG_IT) { return "Reimposta associazione"; }
            if (_currentLang == LANG_PT) { return "Redefinir emparelhamento"; }
            return "Reset Pairing";
        }
        if (key.equals("MENU_HISTORY")) {
            if (_currentLang == LANG_FR) { return "Historique Local"; }
            if (_currentLang == LANG_DE) { return "Verlauf Lokal"; }
            if (_currentLang == LANG_ES) { return "Historial Local"; }
            if (_currentLang == LANG_IT) { return "Storico Locale"; }
            if (_currentLang == LANG_PT) { return "Historico Local"; }
            return "Local History";
        }
        if (key.equals("MENU_FOOTER")) {
            if (_currentLang == LANG_FR) { return "UP/DN: Choix | START: OK"; }
            if (_currentLang == LANG_DE) { return "UP/DN: Wahl | START: OK"; }
            if (_currentLang == LANG_ES) { return "UP/DN: Elegir | START: OK"; }
            if (_currentLang == LANG_IT) { return "UP/DN: Scelta | START: OK"; }
            if (_currentLang == LANG_PT) { return "UP/DN: Opcao | START: OK"; }
            return "UP/DN: Select | START: OK";
        }

        if (key.equals("PLAYER_LABEL")) {
            if (_currentLang == LANG_FR) { return "Joueur :"; }
            if (_currentLang == LANG_DE) { return "Spieler :"; }
            if (_currentLang == LANG_ES) { return "Jugador :"; }
            if (_currentLang == LANG_IT) { return "Giocatore :"; }
            if (_currentLang == LANG_PT) { return "Jogador :"; }
            return "Player :";
        }

        // --- NOUVEAU PROTOCOLE D'APPAIRAGE GARMIN <-> WEB ---
        if (key.equals("PAIR_INPUT_TITLE")) {
            if (_currentLang == LANG_FR) { return "CODE APPAIRAGE WEB"; }
            if (_currentLang == LANG_DE) { return "WEB-KOPPLUNGSCODE"; }
            if (_currentLang == LANG_ES) { return "CODIGO VINCULACION"; }
            if (_currentLang == LANG_IT) { return "CODICE ASSOCIAZIONE"; }
            if (_currentLang == LANG_PT) { return "CODIGO EMPARELHAMENTO"; }
            return "WEB PAIRING CODE";
        }
        if (key.equals("PAIR_INPUT_SUB")) {
            if (_currentLang == LANG_FR) { return "Code a 6 caracteres :"; }
            if (_currentLang == LANG_DE) { return "6-stelliger Code:"; }
            if (_currentLang == LANG_ES) { return "Codigo de 6 car.:"; }
            if (_currentLang == LANG_IT) { return "Codice a 6 caratteri:"; }
            if (_currentLang == LANG_PT) { return "Codigo de 6 caracteres:"; }
            return "6-character code:";
        }
        if (key.equals("PAIR_SUCCESS_TITLE")) {
            if (_currentLang == LANG_FR) { return "Montre associee avec succes !"; }
            if (_currentLang == LANG_DE) { return "Uhr erfolgreich gekoppelt!"; }
            if (_currentLang == LANG_ES) { return "Reloj vinculado con exito!"; }
            if (_currentLang == LANG_IT) { return "Orologio associato!"; }
            if (_currentLang == LANG_PT) { return "Relogio emparelhado!"; }
            return "Watch Paired Successfully!";
        }
        if (key.equals("PAIR_FAIL_TITLE")) {
            if (_currentLang == LANG_FR) { return "Code invalide ou expire"; }
            if (_currentLang == LANG_DE) { return "Ungultiger/abgelaufener Code"; }
            if (_currentLang == LANG_ES) { return "Codigo invalido o caducado"; }
            if (_currentLang == LANG_IT) { return "Codice non valido o scaduto"; }
            if (_currentLang == LANG_PT) { return "Codigo invalido ou expirado"; }
            return "Invalid or Expired Code";
        }
        if (key.equals("PAIR_STATUS_TITLE")) {
            if (_currentLang == LANG_FR) { return "STATUT APPAIRAGE"; }
            if (_currentLang == LANG_DE) { return "KOPPLUNGSSTATUS"; }
            if (_currentLang == LANG_ES) { return "ESTADO VINCULACION"; }
            if (_currentLang == LANG_IT) { return "STATO ASSOCIAZIONE"; }
            if (_currentLang == LANG_PT) { return "STATUS EMPARELHAMENTO"; }
            return "PAIRING STATUS";
        }
        if (key.equals("PAIR_CONFIRM_PROMPT")) {
            if (_currentLang == LANG_FR) { return "START: Valider | BACK: Retour"; }
            if (_currentLang == LANG_DE) { return "START: Bestatigen | BACK: Zuruck"; }
            if (_currentLang == LANG_ES) { return "START: Validar | BACK: Volver"; }
            if (_currentLang == LANG_IT) { return "START: Conferma | BACK: Indietro"; }
            if (_currentLang == LANG_PT) { return "START: Confirmar | BACK: Voltar"; }
            return "START: Confirm | BACK: Back";
        }
        if (key.equals("ID_SCREEN_FOOTER")) {
            if (_currentLang == LANG_FR) { return "START / BACK : Retour"; }
            if (_currentLang == LANG_DE) { return "START / BACK : Zuruck"; }
            if (_currentLang == LANG_ES) { return "START / BACK : Volver"; }
            if (_currentLang == LANG_IT) { return "START / BACK : Indietro"; }
            if (_currentLang == LANG_PT) { return "START / BACK : Voltar"; }
            return "START / BACK : Return";
        }

        // --- G3: PIN INPUT ---
        if (key.equals("PIN_TITLE")) {
            if (_currentLang == LANG_FR) { return "REJOINDRE UN SALON"; }
            if (_currentLang == LANG_DE) { return "RAUM BEITRETEN"; }
            if (_currentLang == LANG_ES) { return "UNIRSE A UNA SALA"; }
            if (_currentLang == LANG_IT) { return "ENTRA IN UNA STANZA"; }
            if (_currentLang == LANG_PT) { return "ENTRAR NUMA SALA"; }
            return "JOIN A ROOM";
        }
        if (key.equals("PIN_SUB")) {
            if (_currentLang == LANG_FR) { return "Code PIN alphanumerique (5 car.)"; }
            if (_currentLang == LANG_DE) { return "5-stelliger Alphanum-Code"; }
            if (_currentLang == LANG_ES) { return "Codigo PIN alfanum. (5 car.)"; }
            if (_currentLang == LANG_IT) { return "PIN alfanumerico (5 car.)"; }
            if (_currentLang == LANG_PT) { return "PIN alfanumerico (5 car.)"; }
            return "5-char alphanumeric PIN";
        }
        if (key.equals("PIN_HELP_1")) {
            if (_currentLang == LANG_FR) { return "UP / DOWN : Caractere"; }
            if (_currentLang == LANG_DE) { return "UP / DOWN : Zeichen"; }
            if (_currentLang == LANG_ES) { return "UP / DOWN : Caracter"; }
            if (_currentLang == LANG_IT) { return "UP / DOWN : Carattere"; }
            if (_currentLang == LANG_PT) { return "UP / DOWN : Caractere"; }
            return "UP / DOWN : Character";
        }
        if (key.equals("PIN_HELP_2")) {
            if (_currentLang == LANG_FR) { return "START: Suiv | BACK: Ret"; }
            if (_currentLang == LANG_DE) { return "START: Weit | BACK: Zur"; }
            if (_currentLang == LANG_ES) { return "START: Sig | BACK: Atras"; }
            if (_currentLang == LANG_IT) { return "START: Avan | BACK: Ind"; }
            if (_currentLang == LANG_PT) { return "START: Prox | BACK: Volt"; }
            return "START: Next | BACK: Back";
        }
        if (key.equals("PIN_INVALID")) {
            if (_currentLang == LANG_FR) { return "PIN INVALIDE"; }
            if (_currentLang == LANG_DE) { return "PIN UNGULTIG"; }
            if (_currentLang == LANG_ES) { return "PIN INVALIDO"; }
            if (_currentLang == LANG_IT) { return "PIN NON VALIDO"; }
            if (_currentLang == LANG_PT) { return "PIN INVALIDO"; }
            return "INVALID PIN";
        }

        // --- PENDING APPROVAL SCREEN ---
        if (key.equals("PENDING_TITLE")) {
            if (_currentLang == LANG_FR) { return "EN ATTENTE"; }
            if (_currentLang == LANG_DE) { return "WARTEPOSITION"; }
            if (_currentLang == LANG_ES) { return "EN ESPERA"; }
            if (_currentLang == LANG_IT) { return "IN ATTESA"; }
            if (_currentLang == LANG_PT) { return "EM ESPERA"; }
            return "PENDING";
        }
        if (key.equals("PENDING_SUB")) {
            if (_currentLang == LANG_FR) { return "Validation par l'hote..."; }
            if (_currentLang == LANG_DE) { return "Warten auf Freigabe..."; }
            if (_currentLang == LANG_ES) { return "Validacion del anfitrion..."; }
            if (_currentLang == LANG_IT) { return "Convalida dall'host..."; }
            if (_currentLang == LANG_PT) { return "Validacao pelo host..."; }
            return "Waiting host approval...";
        }
        if (key.equals("PENDING_HINT")) {
            if (_currentLang == LANG_FR) { return "Patientez sur votre montre"; }
            if (_currentLang == LANG_DE) { return "Bitte kurz warten"; }
            if (_currentLang == LANG_ES) { return "Espere en su reloj"; }
            if (_currentLang == LANG_IT) { return "Attendi sul tuo orologio"; }
            if (_currentLang == LANG_PT) { return "Aguarde no seu relogio"; }
            return "Please wait on your watch";
        }
        if (key.equals("PENDING_REJECTED")) {
            if (_currentLang == LANG_FR) { return "CONNEXION REFUSEE"; }
            if (_currentLang == LANG_DE) { return "ZUGRIFF ABGELEHNT"; }
            if (_currentLang == LANG_ES) { return "ACCESO DENEGADO"; }
            if (_currentLang == LANG_IT) { return "ACCESSO NEGATO"; }
            if (_currentLang == LANG_PT) { return "ACESSO NEGADO"; }
            return "ACCESS DENIED";
        }
        if (key.equals("PENDING_APPROVED")) {
            if (_currentLang == LANG_FR) { return "ACCES VALIDE !"; }
            if (_currentLang == LANG_DE) { return "FREIGEGEBEN !"; }
            if (_currentLang == LANG_ES) { return "ACCESO VALIDADO !"; }
            if (_currentLang == LANG_IT) { return "ACCESSO APPROVATO !"; }
            if (_currentLang == LANG_PT) { return "ACESSO APROVADO !"; }
            return "ACCESS APPROVED !";
        }

        // --- G4: LOBBY & WAITING ROOM ---
        if (key.equals("WAITING_OPPONENT")) {
            if (_currentLang == LANG_FR) { return "En attente de l'adversaire..."; }
            if (_currentLang == LANG_DE) { return "Warte auf Gegner..."; }
            if (_currentLang == LANG_ES) { return "Esperando al rival..."; }
            if (_currentLang == LANG_IT) { return "In attesa dell'avversario..."; }
            if (_currentLang == LANG_PT) { return "Aguardando adversario..."; }
            return "Waiting for opponent...";
        }
        if (key.equals("WAITING_HOST_SIGNAL")) {
            if (_currentLang == LANG_FR) { return "En attente du signal de depart..."; }
            if (_currentLang == LANG_DE) { return "Warte auf Startsignal..."; }
            if (_currentLang == LANG_ES) { return "Esperando senal de salida..."; }
            if (_currentLang == LANG_IT) { return "In attesa del segnale di partenza..."; }
            if (_currentLang == LANG_PT) { return "Aguardando sinal de largada..."; }
            return "Waiting for start signal...";
        }
        if (key.equals("WAITING_SCHEDULED")) {
            if (_currentLang == LANG_FR) { return "Depart programme..."; }
            if (_currentLang == LANG_DE) { return "Geplanter Start..."; }
            if (_currentLang == LANG_ES) { return "Salida programada..."; }
            if (_currentLang == LANG_IT) { return "Partenza programmata..."; }
            if (_currentLang == LANG_PT) { return "Largada programada..."; }
            return "Scheduled start...";
        }
        if (key.equals("LOBBY_TITLE")) {
            if (_currentLang == LANG_FR) { return "DEPART DANS"; }
            if (_currentLang == LANG_DE) { return "START IN"; }
            if (_currentLang == LANG_ES) { return "SALIDA EN"; }
            if (_currentLang == LANG_IT) { return "PARTENZA TRA"; }
            if (_currentLang == LANG_PT) { return "LARGADA EM"; }
            return "STARTS IN";
        }
        if (key.equals("GET_READY")) {
            if (_currentLang == LANG_FR) { return "A VOS RAMES !"; }
            if (_currentLang == LANG_DE) { return "AN DIE RUDER !"; }
            if (_currentLang == LANG_ES) { return "A REMAR !"; }
            if (_currentLang == LANG_IT) { return "AI REMI !"; }
            if (_currentLang == LANG_PT) { return "AOS REMOS !"; }
            return "GET READY !";
        }
        if (key.equals("CELL_RACERS")) {
            if (_currentLang == LANG_FR) { return "RAMEURS"; }
            if (_currentLang == LANG_DE) { return "STARTER"; }
            if (_currentLang == LANG_ES) { return "REMEROS"; }
            if (_currentLang == LANG_IT) { return "ATLETI"; }
            if (_currentLang == LANG_PT) { return "ATLETAS"; }
            return "RACERS";
        }
        if (key.equals("CELL_TARGET")) {
            if (_currentLang == LANG_FR) { return "CIBLE m"; }
            if (_currentLang == LANG_DE) { return "ZIEL m"; }
            if (_currentLang == LANG_ES) { return "META m"; }
            if (_currentLang == LANG_IT) { return "META m"; }
            if (_currentLang == LANG_PT) { return "META m"; }
            return "TARGET m";
        }
        if (key.equals("CELL_RANK_PTS")) {
            if (_currentLang == LANG_FR) { return "CLT / PTS"; }
            if (_currentLang == LANG_DE) { return "RANG / PKT"; }
            if (_currentLang == LANG_ES) { return "CLAS / PTS"; }
            if (_currentLang == LANG_IT) { return "POS / PTI"; }
            if (_currentLang == LANG_PT) { return "POS / PTS"; }
            return "RANK / PTS";
        }
        if (key.equals("CELL_LAST_BEST")) {
            if (_currentLang == LANG_FR) { return "DERN / REC"; }
            if (_currentLang == LANG_DE) { return "LETZ / REK"; }
            if (_currentLang == LANG_ES) { return "ULT / REC"; }
            if (_currentLang == LANG_IT) { return "ULT / REC"; }
            if (_currentLang == LANG_PT) { return "ULT / REC"; }
            return "LAST / BEST";
        }
        if (key.equals("BTN_VS_BOTS")) {
            if (_currentLang == LANG_FR) { return "START: Bots | BACK: Menu"; }
            if (_currentLang == LANG_DE) { return "START: Bots | BACK: Menu"; }
            if (_currentLang == LANG_ES) { return "START: Bots | BACK: Menu"; }
            if (_currentLang == LANG_IT) { return "START: Bot | BACK: Menu"; }
            if (_currentLang == LANG_PT) { return "START: Bots | BACK: Menu"; }
            return "START: Bots | BACK: Menu";
        }
        if (key.equals("AUTO_START_AT_ZERO")) {
            if (_currentLang == LANG_FR) { return "Depart auto a 00:00"; }
            if (_currentLang == LANG_DE) { return "Autostart bei 00:00"; }
            if (_currentLang == LANG_ES) { return "Salida auto a 00:00"; }
            if (_currentLang == LANG_IT) { return "Partenza auto 00:00"; }
            if (_currentLang == LANG_PT) { return "Largada auto 00:00"; }
            return "Auto start at 00:00";
        }

        // --- G5: 5s SYNCHRONOUS COUNTDOWN ---
        if (key.equals("COUNTDOWN_TITLE")) {
            if (_currentLang == LANG_FR) { return "ATTENTION"; }
            if (_currentLang == LANG_DE) { return "ACHTUNG"; }
            if (_currentLang == LANG_ES) { return "ATENCION"; }
            if (_currentLang == LANG_IT) { return "ATTENZIONE"; }
            if (_currentLang == LANG_PT) { return "ATENCAO"; }
            return "READY";
        }
        if (key.equals("COUNTDOWN_HOLD")) {
            if (_currentLang == LANG_FR) { return "NE RAMEZ PAS AVANT 0"; }
            if (_currentLang == LANG_DE) { return "WARTEN BIS START"; }
            if (_currentLang == LANG_ES) { return "ESPERE AL CERO"; }
            if (_currentLang == LANG_IT) { return "ATTENDI IL VIA"; }
            if (_currentLang == LANG_PT) { return "AGUARDE A LARGADA"; }
            return "HOLD UNTIL START";
        }

        // --- G6 / G7: RACING GARMIN GRID ---
        if (key.equals("GRID_PACE")) {
            if (_currentLang == LANG_FR) { return "ALLURE /500"; }
            if (_currentLang == LANG_DE) { return "PACE /500"; }
            if (_currentLang == LANG_ES) { return "RITMO /500"; }
            if (_currentLang == LANG_IT) { return "PASSO /500"; }
            if (_currentLang == LANG_PT) { return "RITMO /500"; }
            return "PACE /500";
        }
        if (key.equals("GRID_POWER")) {
            if (_currentLang == LANG_FR) { return "PUISS. W"; }
            if (_currentLang == LANG_DE) { return "LEIST. W"; }
            if (_currentLang == LANG_ES) { return "POTEN. W"; }
            if (_currentLang == LANG_IT) { return "POTEN. W"; }
            if (_currentLang == LANG_PT) { return "POTEN. W"; }
            return "POWER W";
        }
        if (key.equals("GRID_DIST")) {
            return "DIST. m";
        }
        if (key.equals("GRID_GAP")) {
            if (_currentLang == LANG_FR) { return "ECART m"; }
            if (_currentLang == LANG_DE) { return "ABST. m"; }
            if (_currentLang == LANG_ES) { return "DIF. m"; }
            if (_currentLang == LANG_IT) { return "DISTAC. m"; }
            if (_currentLang == LANG_PT) { return "DIF. m"; }
            return "GAP m";
        }
        if (key.equals("GRID_REM")) {
            if (_currentLang == LANG_FR) { return "RESTE m"; }
            if (_currentLang == LANG_DE) { return "REST m"; }
            if (_currentLang == LANG_ES) { return "FALTA m"; }
            if (_currentLang == LANG_IT) { return "RESTA m"; }
            if (_currentLang == LANG_PT) { return "FALTA m"; }
            return "REM. m";
        }
        if (key.equals("GRID_PREV")) {
            if (_currentLang == LANG_FR) { return "DEVANT m"; }
            if (_currentLang == LANG_DE) { return "VORNE m"; }
            if (_currentLang == LANG_ES) { return "DELANTE m"; }
            if (_currentLang == LANG_IT) { return "DAVANTI m"; }
            if (_currentLang == LANG_PT) { return "FRENTE m"; }
            return "AHEAD m";
        }
        if (key.equals("GRID_NEXT")) {
            if (_currentLang == LANG_FR) { return "DERRIERE m"; }
            if (_currentLang == LANG_DE) { return "HINTEN m"; }
            if (_currentLang == LANG_ES) { return "DETRAS m"; }
            if (_currentLang == LANG_IT) { return "DIETRO m"; }
            if (_currentLang == LANG_PT) { return "ATRAS m"; }
            return "BEHIND m";
        }
        if (key.equals("GRID_AVG_PACE")) {
            if (_currentLang == LANG_FR) { return "MOY /500"; }
            if (_currentLang == LANG_DE) { return "SCHN /500"; }
            if (_currentLang == LANG_ES) { return "MED /500"; }
            if (_currentLang == LANG_IT) { return "MED /500"; }
            if (_currentLang == LANG_PT) { return "MED /500"; }
            return "AVG /500";
        }
        if (key.equals("GRID_AVG_POWER")) {
            if (_currentLang == LANG_FR) { return "MOY W"; }
            if (_currentLang == LANG_DE) { return "SCHN W"; }
            if (_currentLang == LANG_ES) { return "MED W"; }
            if (_currentLang == LANG_IT) { return "MED W"; }
            if (_currentLang == LANG_PT) { return "MED W"; }
            return "AVG W";
        }
        if (key.equals("GRID_WORK")) {
            if (_currentLang == LANG_FR) { return "TRAVAIL J"; }
            if (_currentLang == LANG_DE) { return "ARBEIT J"; }
            if (_currentLang == LANG_ES) { return "TRABAJO J"; }
            if (_currentLang == LANG_IT) { return "LAVORO J"; }
            if (_currentLang == LANG_PT) { return "TRAB. J"; }
            return "WORK J";
        }
        if (key.equals("GRID_FORCE")) {
            if (_currentLang == LANG_FR) { return "FORCE N"; }
            if (_currentLang == LANG_DE) { return "KRAFT N"; }
            if (_currentLang == LANG_ES) { return "FUERZA N"; }
            if (_currentLang == LANG_IT) { return "FORZA N"; }
            if (_currentLang == LANG_PT) { return "FORCA N"; }
            return "FORCE N";
        }
        if (key.equals("HUD_LEADER")) {
            if (_currentLang == LANG_FR) { return "1er"; }
            if (_currentLang == LANG_DE) { return "1."; }
            if (_currentLang == LANG_ES) { return "1ro"; }
            if (_currentLang == LANG_IT) { return "1o"; }
            if (_currentLang == LANG_PT) { return "1o"; }
            return "1st";
        }
        if (key.equals("FOOT_STROKES")) {
            if (_currentLang == LANG_FR) { return "cps"; }
            if (_currentLang == LANG_DE) { return "schl"; }
            if (_currentLang == LANG_ES) { return "pal"; }
            if (_currentLang == LANG_IT) { return "col"; }
            if (_currentLang == LANG_PT) { return "rem"; }
            return "stk";
        }

        // --- WARNINGS & PENALTIES ---
        if (key.equals("WARN_FALSE_START")) {
            if (_currentLang == LANG_FR) { return "ARRÊTEZ DE RAMER ! DÉPART ARRÊTÉ"; }
            if (_currentLang == LANG_DE) { return "NICHT RUDERN ! STEHENDER START"; }
            if (_currentLang == LANG_ES) { return "DEJE DE REMAR ! SALIDA PARADA"; }
            if (_currentLang == LANG_IT) { return "FERMATI ! PARTENZA DA FERMO"; }
            if (_currentLang == LANG_PT) { return "PARE DE REMAR ! LARGADA PARADA"; }
            return "STOP ROWING ! STANDING START";
        }
        if (key.equals("WARN_MISSED_START")) {
            if (_currentLang == LANG_FR) { return "DÉPART RATÉ - ARRÊTEZ LE RAMEUR POUR PARTIR"; }
            if (_currentLang == LANG_DE) { return "FEHLSTART - STOPPEN ZUM STARTEN"; }
            if (_currentLang == LANG_ES) { return "SALIDA NULA - PARE EL REMO PARA SALIR"; }
            if (_currentLang == LANG_IT) { return "PARTENZA FALSA - FERMA IL REMO PER PARTIRE"; }
            if (_currentLang == LANG_PT) { return "LARGADA QUEIMADA - PARE O REMO PARA SAIR"; }
            return "MISSED START - STOP ROWER TO START";
        }
        if (key.equals("MENU_PROFILE")) {
            if (_currentLang == LANG_FR) { return "Mon Profil & Identifiant"; }
            if (_currentLang == LANG_DE) { return "Mein Profil & ID"; }
            if (_currentLang == LANG_ES) { return "Mi Perfil e ID"; }
            if (_currentLang == LANG_IT) { return "Mio Profilo e ID"; }
            if (_currentLang == LANG_PT) { return "Meu Perfil e ID"; }
            return "My Profile & ID";
        }
        if (key.equals("MENU_PSEUDO")) {
            if (_currentLang == LANG_FR) { return "Modifier pseudo"; }
            if (_currentLang == LANG_DE) { return "Spitzname andern"; }
            if (_currentLang == LANG_ES) { return "Cambiar apodo"; }
            if (_currentLang == LANG_IT) { return "Modifica nickname"; }
            if (_currentLang == LANG_PT) { return "Mudar apelido"; }
            return "Edit Nickname";
        }
        if (key.equals("PROFILE_SYNCED_WEB")) {
            if (_currentLang == LANG_FR) { return "Pseudo synchronise avec votre compte web"; }
            return "Nickname synced with your web account";
        }
        if (key.equals("PROFILE_EDIT_PSEUDO")) {
            if (_currentLang == LANG_FR) { return "Modifier pseudo invite"; }
            return "Edit guest nickname";
        }
        if (key.equals("BLE_WAIT_WAKE")) {
            if (_currentLang == LANG_FR) { return "Donnez un coup de rame pour reveiller le rameur"; }
            return "Pull handle once to wake rower";
        }
        if (key.equals("BLE_READY_WAIT_START")) {
            if (_currentLang == LANG_FR) { return "Rameur pret - En attente du depart"; }
            return "Rower ready - Waiting for start";
        }
        if (key.equals("POST_RACE_PAUSE_LABEL")) {
            if (_currentLang == LANG_FR) { return "Prochaine manche : "; }
            if (_currentLang == LANG_DE) { return "Naechstes Rennen : "; }
            if (_currentLang == LANG_ES) { return "Prox. regata : "; }
            if (_currentLang == LANG_IT) { return "Prossima regata : "; }
            if (_currentLang == LANG_PT) { return "Prox. regata : "; }
            return "Next race : ";
        }
        if (key.equals("WARN_NO_ROW")) {
            if (_currentLang == LANG_FR) { return "NE RAMEZ PAS"; }
            if (_currentLang == LANG_DE) { return "NICHT RUDERN"; }
            if (_currentLang == LANG_ES) { return "NO REME AUN"; }
            if (_currentLang == LANG_IT) { return "NON VOGARE"; }
            if (_currentLang == LANG_PT) { return "NAO REME"; }
            return "DO NOT ROW";
        }
        if (key.equals("WARN_ZERO_SPEED")) {
            if (_currentLang == LANG_FR) { return "Arret complet requis"; }
            if (_currentLang == LANG_DE) { return "Stopp erforderlich"; }
            if (_currentLang == LANG_ES) { return "Parada requerida"; }
            if (_currentLang == LANG_IT) { return "Fermati per partire"; }
            if (_currentLang == LANG_PT) { return "Pare para largar"; }
            return "Full stop required";
        }
        if (key.equals("WARN_WAIT_START")) {
            if (_currentLang == LANG_FR) { return "Attendez le depart"; }
            if (_currentLang == LANG_DE) { return "Warten auf Start"; }
            if (_currentLang == LANG_ES) { return "Espere la salida"; }
            if (_currentLang == LANG_IT) { return "Attendi partenza"; }
            if (_currentLang == LANG_PT) { return "Aguarde largada"; }
            return "Wait for start";
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
            if (_currentLang == LANG_FR) { return "Sauver & Quitter"; }
            if (_currentLang == LANG_DE) { return "Speichern & Ende"; }
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
            if (_currentLang == LANG_FR) { return "TERMINE"; }
            if (_currentLang == LANG_DE) { return "BEENDET"; }
            if (_currentLang == LANG_ES) { return "TERMINADO"; }
            if (_currentLang == LANG_IT) { return "TERMINATO"; }
            if (_currentLang == LANG_PT) { return "CONCLUIDO"; }
            return "FINISHED";
        }
        if (key.equals("CELL_TIME")) {
            if (_currentLang == LANG_FR) { return "CHRONO"; }
            if (_currentLang == LANG_DE) { return "ZEIT"; }
            if (_currentLang == LANG_ES) { return "TIEMPO"; }
            if (_currentLang == LANG_IT) { return "TEMPO"; }
            if (_currentLang == LANG_PT) { return "TEMPO"; }
            return "TIME";
        }
        if (key.equals("PODIUM_TITLE")) {
            if (_currentLang == LANG_FR) { return "PODIUM OFFICIEL"; }
            if (_currentLang == LANG_DE) { return "PODIUM TOP 3"; }
            if (_currentLang == LANG_ES) { return "PODIO OFICIAL"; }
            if (_currentLang == LANG_IT) { return "PODIO UFFICIALE"; }
            if (_currentLang == LANG_PT) { return "PODIO OFICIAL"; }
            return "OFFICIAL PODIUM";
        }
        if (key.equals("PODIUM_EMPTY")) {
            if (_currentLang == LANG_FR) { return "Classement en cours..."; }
            if (_currentLang == LANG_DE) { return "Wertung lauft..."; }
            if (_currentLang == LANG_ES) { return "Calculando podio..."; }
            if (_currentLang == LANG_IT) { return "Calcolo podio..."; }
            if (_currentLang == LANG_PT) { return "Calculando podio..."; }
            return "Syncing podium...";
        }
        if (key.equals("FINISH_FOOTER")) {
            if (_currentLang == LANG_FR) { return "UP/DN: Page | START: Menu"; }
            if (_currentLang == LANG_DE) { return "UP/DN: Seite | START: Menu"; }
            if (_currentLang == LANG_ES) { return "UP/DN: Pag | START: Menu"; }
            if (_currentLang == LANG_IT) { return "UP/DN: Pag | START: Menu"; }
            if (_currentLang == LANG_PT) { return "UP/DN: Pag | START: Menu"; }
            return "UP/DN: Page | START: Menu";
        }

        // --- G9: LOCAL HISTORY ---
        if (key.equals("HIST_TITLE")) {
            if (_currentLang == LANG_FR) { return "HISTORIQUE"; }
            if (_currentLang == LANG_DE) { return "VERLAUF"; }
            if (_currentLang == LANG_ES) { return "HISTORIAL"; }
            if (_currentLang == LANG_IT) { return "STORICO"; }
            if (_currentLang == LANG_PT) { return "HISTORICO"; }
            return "HISTORY";
        }
        if (key.equals("HIST_EMPTY")) {
            if (_currentLang == LANG_FR) { return "Aucune course enregistree"; }
            if (_currentLang == LANG_DE) { return "Noch keine Rennen"; }
            if (_currentLang == LANG_ES) { return "Sin carreras guardadas"; }
            if (_currentLang == LANG_IT) { return "Nessuna gara salvata"; }
            if (_currentLang == LANG_PT) { return "Nenhuma corrida salva"; }
            return "No saved races yet";
        }
        if (key.equals("HIST_FOOTER")) {
            if (_currentLang == LANG_FR) { return "START / BACK : Menu"; }
            if (_currentLang == LANG_DE) { return "START / BACK : Menu"; }
            return "START / BACK : Menu";
        }

        // --- LATE ARRIVAL SELECTION ---
        if (key.equals("LATE_TITLE")) {
            if (_currentLang == LANG_FR) { return "COURSE EN COURS"; }
            if (_currentLang == LANG_DE) { return "RENNEN LAUFT"; }
            if (_currentLang == LANG_ES) { return "CARRERA EN CURSO"; }
            if (_currentLang == LANG_IT) { return "GARA IN CORSO"; }
            if (_currentLang == LANG_PT) { return "CORRIDA ATIVA"; }
            return "RACE IN PROGRESS";
        }
        if (key.equals("LATE_OPT_JOIN")) {
            if (_currentLang == LANG_FR) { return "Rejoindre maintenant"; }
            if (_currentLang == LANG_DE) { return "Jetzt beitreten"; }
            if (_currentLang == LANG_ES) { return "Unirse ahora"; }
            if (_currentLang == LANG_IT) { return "Unisciti ora"; }
            if (_currentLang == LANG_PT) { return "Entrar agora"; }
            return "Join race late";
        }
        if (key.equals("LATE_OPT_WAIT")) {
            if (_currentLang == LANG_FR) { return "Attendre prochaine"; }
            if (_currentLang == LANG_DE) { return "Nachstes Rennen"; }
            if (_currentLang == LANG_ES) { return "Esperar proxima"; }
            if (_currentLang == LANG_IT) { return "Attendi prossima"; }
            if (_currentLang == LANG_PT) { return "Aguardar proxima"; }
            return "Wait next race";
        }

        // --- BOTS PROMPT ---
        if (key.equals("BOTS_PROMPT_TITLE")) {
            if (_currentLang == LANG_FR) { return "AJOUTER BOTS ?"; }
            if (_currentLang == LANG_DE) { return "BOTS HINZUFUGEN?"; }
            if (_currentLang == LANG_ES) { return "ANADIR BOTS ?"; }
            if (_currentLang == LANG_IT) { return "AGGIUNGI BOT ?"; }
            if (_currentLang == LANG_PT) { return "ADICIONAR BOTS ?"; }
            return "ADD BOT RACERS?";
        }
        if (key.equals("BTN_YES_BOTS")) {
            if (_currentLang == LANG_FR) { return "Oui, 3 bots calibres"; }
            if (_currentLang == LANG_DE) { return "Ja, 3 Bots starten"; }
            if (_currentLang == LANG_ES) { return "Si, 3 bots"; }
            if (_currentLang == LANG_IT) { return "Si, 3 bot"; }
            if (_currentLang == LANG_PT) { return "Sim, 3 bots"; }
            return "Yes, add 3 bots";
        }
        if (key.equals("BTN_NO_SOLO")) {
            if (_currentLang == LANG_FR) { return "Non, sans bots"; }
            if (_currentLang == LANG_DE) { return "Nein, ohne Bots"; }
            if (_currentLang == LANG_ES) { return "No, sin bots"; }
            if (_currentLang == LANG_IT) { return "No, senza bot"; }
            if (_currentLang == LANG_PT) { return "Nao, sem bots"; }
            return "No, keep human only";
        }

        return key;
    }
}
