/**
 * Service de gestion des courriels pour la plateforme Rower Race.
 * Intégration directe de l'API REST Resend (HTTPS) avec modèles Cyber/Sport responsive,
 * internationalisation (langue de l'organisateur avec repli par défaut en anglais)
 * et repli sécurisé en mode simulation pour le développement et les tests.
 */
import { buildShareableRoomUrl, normalizeSalonCode, withRegattaMode } from "../utils/room-link.util";

export interface EmailAttachment {
  filename: string;
  content: string; // Base64 ou contenu texte
  type?: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

export interface RoomInvitationEmailParams {
  to: string;
  organizerName: string;
  roomTitle: string;
  targetDistance: number;
  roomCode: string;
  roomPin: string;
  joinUrl: string;
  isDuel: boolean;
  scheduledStartTime?: string;
  timezone?: string;
  icsCalendarContent?: string;
  googleCalendarUrl?: string;
  outlookCalendarUrl?: string;
  lang?: string;
}

export interface EmailConfig {
  resendApiKey: string;
  fromEmail: string;
  frontendUrl: string;
  logoUrl: string;
}

/**
 * Palette de l'identité visuelle Rower Race (couleurs du logo kayak néon du site).
 */
export const BRAND_COLORS = {
  bg: "#060913",
  card: "#0c1a38",
  cyan: "#00f0ff",
  pink: "#ff0055",
  orange: "#ff6600",
  yellow: "#ffe600",
  text: "#e2e8f0",
  dim: "#94a3b8",
} as const;

export function getEmailConfig(): EmailConfig {
  const isProd = process.env.NODE_ENV === "production";
  const defaultFrontend = isProd ? "https://rowerrace.com" : "http://localhost:4200";
  const frontendUrl = (process.env.FRONTEND_URL || defaultFrontend).trim().replace(/\/+$/, "");
  // Les clients mail (Gmail, Outlook) bloquent le SVG : logo PNG publié par le frontend.
  // En local, le logo de production est utilisé (localhost n'est pas joignable depuis un client mail).
  const logoOrigin = frontendUrl.includes("localhost") ? "https://rowerrace.com" : frontendUrl;
  return {
    resendApiKey: (process.env.RESEND_API_KEY || "").trim(),
    fromEmail: (process.env.EMAIL_FROM || "Rower Race <contact@rowerrace.com>").trim(),
    frontendUrl,
    logoUrl: (process.env.EMAIL_LOGO_URL || `${logoOrigin}/email/rowerrace-logo.png`).trim(),
  };
}

/**
 * Générateur de gabarit HTML responsive aux couleurs Cyber / Sport de Rower Race.
 */
export function renderCyberEmailHtml(params: {
  title: string;
  preheader: string;
  bodyContentHtml: string;
  ctaText?: string;
  ctaUrl?: string;
  securityNote?: string;
  lang?: string;
}): string {
  const isFr = (params.lang || "fr").toLowerCase().startsWith("fr");
  const htmlLang = isFr ? "fr" : "en";
  const emailConfig = getEmailConfig();
  const logoUrl = emailConfig.logoUrl;
  const logoLinkUrl = emailConfig.frontendUrl;

  const ctaBlock = params.ctaUrl && params.ctaText ? `
    <div style="text-align: center; margin: 32px 0 24px 0;">
      <a href="${params.ctaUrl}" style="background-color: ${BRAND_COLORS.pink}; background-image: linear-gradient(90deg, ${BRAND_COLORS.pink} 0%, ${BRAND_COLORS.orange} 55%, ${BRAND_COLORS.yellow} 100%); color: #ffffff; font-weight: 800; text-decoration: none; padding: 15px 30px; border-radius: 8px; display: inline-block; font-size: 15px; letter-spacing: 0.8px; text-transform: uppercase; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35); box-shadow: 0 0 18px rgba(255, 0, 85, 0.45);">
        ${params.ctaText}
      </a>
    </div>
  ` : '';

  const securityBlock = params.securityNote ? `
    <div style="background-color: rgba(0, 240, 255, 0.05); border-left: 3px solid #00f0ff; padding: 12px 16px; margin-top: 24px; border-radius: 4px; font-size: 13px; color: #94a3b8; line-height: 1.5;">
      ${params.securityNote}
    </div>
  ` : '';

  const subtitle = isFr
    ? "Plateforme de Régates &amp; Entraînement Connecté"
    : "Connected Indoor Rowing &amp; Live Regatta Platform";

  const footerText = isFr
    ? `&copy; ${new Date().getFullYear()} Rower Race &bull; Tous droits réservés.<br>Ce courriel vous a été envoyé automatiquement, merci de ne pas y répondre directement.`
    : `&copy; ${new Date().getFullYear()} Rower Race &bull; All rights reserved.<br>This email was sent automatically, please do not reply directly.`;

  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${params.title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #060913; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f1f5f9;">
  <div style="display: none; font-size: 1px; color: #060913; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    ${params.preheader}
  </div>
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #060913; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 580px; background-color: #0b1226; border: 1px solid rgba(0, 240, 255, 0.35); border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <!-- Header Branding -->
          <tr>
            <td style="padding: 26px 30px 20px 30px; text-align: center; background-color: ${BRAND_COLORS.bg}; background-image: linear-gradient(180deg, rgba(0, 240, 255, 0.10) 0%, rgba(6, 9, 19, 0) 100%);">
              <a href="${logoLinkUrl}" style="text-decoration: none;" title="ROWER RACE">
                <img src="${logoUrl}" width="76" height="76" alt="ROWER RACE" style="display: block; margin: 0 auto 10px auto; width: 76px; height: 76px; border: 0; outline: none;">
              </a>
              <div style="font-size: 26px; font-weight: 900; letter-spacing: 3px; text-transform: uppercase; line-height: 1.1;">
                <span style="color: ${BRAND_COLORS.cyan};">ROWER</span> <span style="color: ${BRAND_COLORS.pink};">RACE</span>
              </div>
              <div style="font-size: 12px; color: ${BRAND_COLORS.dim}; letter-spacing: 1px; text-transform: uppercase; margin-top: 6px;">
                ${subtitle}
              </div>
            </td>
          </tr>
          <!-- Barre aux couleurs de la coque du logo -->
          <tr>
            <td style="height: 4px; line-height: 4px; font-size: 0; background-color: ${BRAND_COLORS.orange}; background-image: linear-gradient(90deg, ${BRAND_COLORS.pink} 0%, ${BRAND_COLORS.orange} 50%, ${BRAND_COLORS.yellow} 100%);">&nbsp;</td>
          </tr>
          <!-- Content Body -->
          <tr>
            <td style="padding: 30px; font-size: 15px; line-height: 1.6; color: #cbd5e1;">
              ${params.bodyContentHtml}
              ${ctaBlock}
              ${securityBlock}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid rgba(255, 255, 255, 0.05);">
              ${footerText}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export class EmailService {
  private static instance: EmailService;
  private sentEmailsLog: EmailPayload[] = [];

  private constructor() {}

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  /**
   * Envoi d'un courriel via l'API REST HTTPS Resend (ou simulation si non configuré)
   */
  public async sendEmail(payload: EmailPayload): Promise<{ success: boolean; messageId: string }> {
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.sentEmailsLog.push(payload);

    const config = getEmailConfig();

    if (config.resendApiKey && process.env.NODE_ENV !== "test") {
      try {
        const reqBody: Record<string, any> = {
          from: config.fromEmail,
          to: payload.to,
          subject: payload.subject,
          text: payload.text,
          html: payload.html || payload.text.replace(/\n/g, "<br>"),
        };
        if (payload.attachments && payload.attachments.length > 0) {
          reqBody.attachments = payload.attachments.map((att) => ({
            filename: att.filename,
            content: att.content,
          }));
        }

        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.resendApiKey}`,
          },
          body: JSON.stringify(reqBody),
        });

        if (response.ok) {
          const data = (await response.json()) as any;
          return { success: true, messageId: data.id || messageId };
        } else {
          const errText = await response.text();
          console.error(`[EmailService/Resend] Erreur envoi: ${response.status} - ${errText}`);
        }
      } catch (err) {
        console.error("[EmailService/Resend] Exception envoi courriel:", err);
      }
    } else {
      console.log(`[EmailService] Mode simulation (RESEND_API_KEY absente) vers: ${payload.to} | Sujet: ${payload.subject}`);
    }

    return { success: true, messageId };
  }

  /**
   * Envoi d'un courriel de bienvenue lors de la création d'un compte abonné
   */
  public async sendWelcomeEmail(to: string, userName: string, login: string, lang: string = "fr"): Promise<boolean> {
    const config = getEmailConfig();
    const isFr = (lang || "fr").toLowerCase().startsWith("fr");
    const displayName = (userName || login).trim();

    if (isFr) {
      const subject = "Bienvenue sur Rower Race - Votre compte abonné est créé";
      const bodyContentHtml = `
        <h2 style="color: #ffffff; font-size: 20px; margin-top: 0; margin-bottom: 16px;">
          Bonjour <span style="color: #00f0ff;">${displayName}</span>,
        </h2>
        <p style="margin-bottom: 20px;">
          Merci d'avoir rejoint <strong>Rower Race</strong> ! Votre compte abonné a été créé et activé avec succès.
        </p>

        <div style="background-color: #0d1527; border: 1px solid rgba(0, 240, 255, 0.3); border-radius: 8px; padding: 18px; margin: 20px 0;">
          <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 6px;">
            Votre identifiant de connexion unique :
          </div>
          <div style="font-size: 20px; font-weight: bold; color: #00f0ff; font-family: monospace;">
            ${login}
          </div>
        </div>

        <div style="background-color: rgba(0, 240, 255, 0.05); border: 1px solid rgba(0, 240, 255, 0.2); border-radius: 8px; padding: 16px; margin: 20px 0;">
          <div style="font-size: 14px; font-weight: bold; color: #00f0ff; margin-bottom: 8px;">
            ⌚ Appairage Montre Garmin Connect IQ
          </div>
          <p style="margin: 0 0 8px 0; font-size: 13px; color: #cbd5e1; line-height: 1.5;">
            Installez l'application <strong>Rower Race</strong> sur votre montre Garmin depuis l'application Garmin (Garmin Connect IQ) ou sur <a href="https://apps.garmin.com" style="color: #00f0ff; text-decoration: underline;">apps.garmin.com</a>.
          </p>
          <p style="margin: 0; font-size: 13px; color: #94a3b8; line-height: 1.5;">
            Saisissez votre identifiant unique <strong>${login}</strong> ou utilisez la liaison par code PIN pour synchroniser votre télémétrie en temps réel (Watts, cadence, allure /500m, FC).
          </p>
        </div>

        <p style="margin-bottom: 12px;">
          En tant qu'abonné, vous profitez dès aujourd'hui de tous vos avantages exclusifs :
        </p>
        <ul style="padding-left: 20px; margin-bottom: 24px; color: #cbd5e1;">
          <li style="margin-bottom: 8px;"><strong>Salons privés illimités :</strong> organisez des régates en direct avec vos amis ou votre club.</li>
          <li style="margin-bottom: 8px;"><strong>Appairage montre Garmin :</strong> synchronisation instantanée de votre télémétrie rameur.</li>
          <li style="margin-bottom: 8px;"><strong>Ligues et classements :</strong> mesurez-vous à la communauté mondiale dans les divisions hebdomadaires.</li>
        </ul>
      `;

      const html = renderCyberEmailHtml({
        title: subject,
        preheader: `Bienvenue sur Rower Race ! Votre login unique est : ${login}`,
        bodyContentHtml,
        ctaText: "Accéder à Rower Race",
        ctaUrl: config.frontendUrl,
        securityNote: "Conservez précieusement votre login, il vous sera demandé lors de l'appairage avec votre application montre Garmin Connect IQ.",
        lang: "fr",
      });

      const text = `Bonjour ${displayName},\n\nMerci pour votre inscription ! Votre compte abonné Rower Race est prêt.\nVotre login unique : ${login}\n\nAppairage montre Garmin : Installez l'application Rower Race sur votre montre Garmin depuis l'application Garmin (Garmin Connect IQ ou apps.garmin.com) et saisissez votre identifiant pour synchroniser vos métriques.\n\nAccédez à la plateforme : ${config.frontendUrl}\n\nSportivement,\nL'équipe Rower Race`;

      const res = await this.sendEmail({ to, subject, text, html });
      return res.success;
    } else {
      // English version
      const subject = "Welcome to Rower Race - Your subscriber account is active";
      const bodyContentHtml = `
        <h2 style="color: #ffffff; font-size: 20px; margin-top: 0; margin-bottom: 16px;">
          Hello <span style="color: #00f0ff;">${displayName}</span>,
        </h2>
        <p style="margin-bottom: 20px;">
          Thank you for joining <strong>Rower Race</strong>! Your subscriber account is created and fully activated.
        </p>

        <div style="background-color: #0d1527; border: 1px solid rgba(0, 240, 255, 0.3); border-radius: 8px; padding: 18px; margin: 20px 0;">
          <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 6px;">
            Your unique login ID:
          </div>
          <div style="font-size: 20px; font-weight: bold; color: #00f0ff; font-family: monospace;">
            ${login}
          </div>
        </div>

        <div style="background-color: rgba(0, 240, 255, 0.05); border: 1px solid rgba(0, 240, 255, 0.2); border-radius: 8px; padding: 16px; margin: 20px 0;">
          <div style="font-size: 14px; font-weight: bold; color: #00f0ff; margin-bottom: 8px;">
            ⌚ Garmin Connect IQ Watch Pairing
          </div>
          <p style="margin: 0 0 8px 0; font-size: 13px; color: #cbd5e1; line-height: 1.5;">
            Install the <strong>Rower Race</strong> app on your Garmin watch from the Garmin app (Garmin Connect IQ) or at <a href="https://apps.garmin.com" style="color: #00f0ff; text-decoration: underline;">apps.garmin.com</a>.
          </p>
          <p style="margin: 0; font-size: 13px; color: #94a3b8; line-height: 1.5;">
            Enter your unique login ID <strong>${login}</strong> or use web PIN pairing to stream your real-time telemetry (Watts, cadence, 500m split, HR).
          </p>
        </div>

        <p style="margin-bottom: 12px;">
          As a subscriber, unlock all exclusive privileges right away:
        </p>
        <ul style="padding-left: 20px; margin-bottom: 24px; color: #cbd5e1;">
          <li style="margin-bottom: 8px;"><strong>Unlimited private rooms:</strong> host live regattas with friends or rowing clubs.</li>
          <li style="margin-bottom: 8px;"><strong>Garmin watch pairing:</strong> instant synchronization of your rowing metrics.</li>
          <li style="margin-bottom: 8px;"><strong>Leagues and leaderboards:</strong> compete with global rowers in weekly divisions.</li>
        </ul>
      `;

      const html = renderCyberEmailHtml({
        title: subject,
        preheader: `Welcome to Rower Race! Your unique login is: ${login}`,
        bodyContentHtml,
        ctaText: "Open Rower Race",
        ctaUrl: config.frontendUrl,
        securityNote: "Keep your login secure; you can use it to link your Garmin watch app.",
        lang: "en",
      });

      const text = `Hello ${displayName},\n\nThank you for signing up! Your Rower Race subscriber account is ready.\nYour unique login: ${login}\n\nGarmin watch pairing: Install the Rower Race app on your Garmin watch from the Garmin app (Garmin Connect IQ or apps.garmin.com) and use your login to sync your metrics.\n\nAccess the platform: ${config.frontendUrl}\n\nBest regards,\nThe Rower Race Team`;

      const res = await this.sendEmail({ to, subject, text, html });
      return res.success;
    }
  }

  /**
   * Envoi d'un courriel de confirmation d'inscription via l'application Garmin
   */
  public async sendRegistrationConfirmationEmail(to: string, login: string, lang: string = "fr"): Promise<boolean> {
    const config = getEmailConfig();
    const isFr = (lang || "fr").toLowerCase().startsWith("fr");

    if (isFr) {
      const subject = "Rower Race - Inscription confirmée par votre montre Garmin";
      const bodyContentHtml = `
        <h2 style="color: #ffffff; font-size: 20px; margin-top: 0; margin-bottom: 16px;">
          Félicitations <span style="color: #00f0ff;">${login}</span> !
        </h2>
        <p style="margin-bottom: 20px;">
          Votre inscription et l'appairage de votre montre Garmin Connect IQ ont bien été validés.
        </p>
        <p style="margin-bottom: 24px;">
          Vos capteurs sont désormais directement reliés au tableau de bord en direct de vos courses. Vous pouvez organiser vos régates privées dès maintenant.
        </p>
      `;

      const html = renderCyberEmailHtml({
        title: subject,
        preheader: `Votre montre Garmin est appairée avec le compte ${login}`,
        bodyContentHtml,
        ctaText: "Lancer une régate",
        ctaUrl: config.frontendUrl,
        lang: "fr",
      });

      const text = `Félicitations !\n\nVotre inscription avec le login ${login} a bien été validée depuis votre montre Garmin Connect IQ.\nVous pouvez dès maintenant organiser vos régates privées sur : ${config.frontendUrl}\n\nL'équipe Rower Race`;

      const res = await this.sendEmail({ to, subject, text, html });
      return res.success;
    } else {
      const subject = "Rower Race - Registration Confirmed by your Garmin Watch";
      const bodyContentHtml = `
        <h2 style="color: #ffffff; font-size: 20px; margin-top: 0; margin-bottom: 16px;">
          Congratulations <span style="color: #00f0ff;">${login}</span>!
        </h2>
        <p style="margin-bottom: 20px;">
          Your registration and Garmin Connect IQ watch pairing have been verified.
        </p>
        <p style="margin-bottom: 24px;">
          Your rower sensors are now directly connected to your live race dashboard. You can create private regattas right now.
        </p>
      `;

      const html = renderCyberEmailHtml({
        title: subject,
        preheader: `Your Garmin watch is paired with account ${login}`,
        bodyContentHtml,
        ctaText: "Start a Regatta",
        ctaUrl: config.frontendUrl,
        lang: "en",
      });

      const text = `Congratulations!\n\nYour registration with login ${login} has been verified from your Garmin Connect IQ watch.\nYou can now host private regattas at: ${config.frontendUrl}\n\nThe Rower Race Team`;

      const res = await this.sendEmail({ to, subject, text, html });
      return res.success;
    }
  }

  /**
   * Envoi d'un courriel de réinitialisation de mot de passe sécurisé
   */
  public async sendPasswordResetEmail(to: string, login: string, resetToken: string, lang: string = "fr"): Promise<boolean> {
    const config = getEmailConfig();
    const isFr = (lang || "fr").toLowerCase().startsWith("fr");
    const resetUrl = `${config.frontendUrl}/?resetToken=${encodeURIComponent(resetToken)}`;

    if (isFr) {
      const subject = "Rower Race - Réinitialisation de votre mot de passe";
      const bodyContentHtml = `
        <h2 style="color: #ffffff; font-size: 20px; margin-top: 0; margin-bottom: 16px;">
          Réinitialisation de mot de passe
        </h2>
        <p style="margin-bottom: 16px;">
          Une demande de réinitialisation de mot de passe a été formulée pour le compte <strong style="color: #00f0ff;">${login}</strong>.
        </p>
        <p style="margin-bottom: 20px;">
          Pour choisir un nouveau mot de passe sécurisé, cliquez sur le bouton ci-dessous. Ce lien à usage unique est valable pendant <strong>1 heure</strong>.
        </p>
      `;

      const html = renderCyberEmailHtml({
        title: subject,
        preheader: `Réinitialisation de votre mot de passe pour le compte ${login}`,
        bodyContentHtml,
        ctaText: "Réinitialiser mon mot de passe",
        ctaUrl: resetUrl,
        securityNote: "Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail en toute sécurité. Votre mot de passe actuel reste inchangé.",
        lang: "fr",
      });

      const text = `Bonjour,\n\nUne demande de réinitialisation de mot de passe a été formulée pour le compte ${login}.\nPour définir un nouveau mot de passe, veuillez utiliser le lien sécurisé suivant (valable 1 heure) :\n${resetUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail en toute sécurité.\n\nSportivement,\nL'équipe Rower Race`;

      const res = await this.sendEmail({ to, subject, text, html });
      return res.success;
    } else {
      const subject = "Rower Race - Password Reset";
      const bodyContentHtml = `
        <h2 style="color: #ffffff; font-size: 20px; margin-top: 0; margin-bottom: 16px;">
          Password Reset
        </h2>
        <p style="margin-bottom: 16px;">
          A password reset request was made for account <strong style="color: #00f0ff;">${login}</strong>.
        </p>
        <p style="margin-bottom: 20px;">
          To choose a new secure password, click the button below. This single-use link is valid for <strong>1 hour</strong>.
        </p>
      `;

      const html = renderCyberEmailHtml({
        title: subject,
        preheader: `Password reset for account ${login}`,
        bodyContentHtml,
        ctaText: "Reset My Password",
        ctaUrl: resetUrl,
        securityNote: "If you did not request this password reset, you can safely ignore this email. Your current password remains unchanged.",
        lang: "en",
      });

      const text = `Hello,\n\nA password reset request was submitted for account ${login}.\nTo set a new password, please use the following secure link (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, you can safely ignore this message.\n\nBest regards,\nThe Rower Race Team`;

      const res = await this.sendEmail({ to, subject, text, html });
      return res.success;
    }
  }

  /**
   * Envoi d'une invitation à une régate ou un duel 1v1 avec codes, lien direct canonique (/r/:code),
   * explications détaillées d'installation et d'appairage montre Garmin Connect IQ Store,
   * et rendez-vous d'agenda iCalendar (.ics) si planifié.
   * La langue utilisée est celle de l'organisateur (si francophone), sinon par défaut en anglais.
   */
  public async sendRoomInvitationEmail(params: RoomInvitationEmailParams): Promise<boolean> {
    const config = getEmailConfig();
    const isFr = (params.lang || "").toLowerCase().startsWith("fr");
    const lang = isFr ? "fr" : "en";

    // Garantir le format canonique de l'URL pour la plateforme (/r/:code),
    // complété par ?mode=regatta pour ouvrir directement le site en mode régate (plein écran paysage).
    const code = params.roomCode || "";
    const baseJoinUrl = params.joinUrl && params.joinUrl.includes("/r/")
      ? params.joinUrl
      : buildShareableRoomUrl(config.frontendUrl, code);
    const canonicalJoinUrl = withRegattaMode(baseJoinUrl);

    const orgName = (params.organizerName || (isFr ? "Un rameur" : "A rower")).trim();

    // Traitement de la date planifiée si présente
    let scheduleSectionHtml = "";
    let scheduleSectionText = "";
    if (params.scheduledStartTime) {
      const d = new Date(params.scheduledStartTime);
      const tz = params.timezone || "Europe/Paris";
      let formattedDate = params.scheduledStartTime;
      try {
        const localeCode = isFr ? "fr-FR" : "en-US";
        const dtf = new Intl.DateTimeFormat(localeCode, {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: tz,
        });
        formattedDate = `${dtf.format(d)} (${tz})`;
      } catch {}

      const calGoogleLabel = isFr ? "📅 Google Agenda" : "📅 Google Calendar";
      const calOutlookLabel = isFr ? "📅 Outlook / Office 365" : "📅 Outlook / Office 365";

      const calButtonsHtml = (params.googleCalendarUrl || params.outlookCalendarUrl) ? `
        <div style="margin-top: 14px; display: flex; flex-wrap: wrap; gap: 10px;">
          ${params.googleCalendarUrl ? `<a href="${params.googleCalendarUrl}" style="background-color: #1e293b; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); text-decoration: none; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; display: inline-block;">${calGoogleLabel}</a>` : ''}
          ${params.outlookCalendarUrl ? `<a href="${params.outlookCalendarUrl}" style="background-color: #1e293b; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); text-decoration: none; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; display: inline-block;">${calOutlookLabel}</a>` : ''}
        </div>
      ` : '';

      const schedHeader = isFr ? "⏰ Démarrage Planifié" : "⏰ Scheduled Start";
      const icsNote = isFr
        ? "📎 Un fichier rendez-vous <strong>.ics</strong> est joint à ce courriel pour intégrer directement votre calendrier."
        : "📎 An <strong>.ics</strong> appointment file is attached to this email to add this event to your calendar.";

      scheduleSectionHtml = `
        <div style="background-color: #0b1329; border-left: 3px solid #f59e0b; padding: 14px 18px; border-radius: 6px; margin: 18px 0;">
          <div style="font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #f59e0b; margin-bottom: 4px;">
            ${schedHeader}
          </div>
          <div style="font-size: 16px; font-weight: bold; color: #ffffff;">
            ${formattedDate}
          </div>
          ${calButtonsHtml}
          ${params.icsCalendarContent ? `<div style="font-size: 12px; color: #94a3b8; margin-top: 8px;">${icsNote}</div>` : ''}
        </div>
      `;
      scheduleSectionText = isFr
        ? `\n⏰ Démarrage planifié : ${formattedDate}\n`
        : `\n⏰ Scheduled Start: ${formattedDate}\n`;
    }

    let subject = "";
    let preheader = "";
    let bodyContentHtml = "";
    let text = "";
    let ctaText = "";
    let securityNote = "";

    if (isFr) {
      // VERSION FRANÇAISE
      const modeBadge = params.isDuel ? "⚔️ Duel 1 vs 1" : "🚣 Régate Multijoueurs";
      subject = params.isDuel
        ? `⚔️ Rower Race - Invitation au Duel 1v1 de ${orgName}`
        : `🚣 Rower Race - Invitation à la régate "${params.roomTitle}" par ${orgName}`;
      preheader = `${orgName} vous invite à la course ${params.roomTitle} (${params.targetDistance}m)`;
      ctaText = "Rejoindre la Régate";
      securityNote = `Ce salon est privé et sécurisé. Votre lien de connexion direct : ${canonicalJoinUrl}`;

      bodyContentHtml = `
        <div style="display: inline-block; background-color: rgba(0, 240, 255, 0.12); border: 1px solid #00f0ff; color: #00f0ff; font-size: 12px; font-weight: bold; text-transform: uppercase; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; letter-spacing: 1px;">
          ${modeBadge}
        </div>
        <h2 style="color: #ffffff; font-size: 22px; margin-top: 0; margin-bottom: 14px; line-height: 1.3;">
          Bonjour,<br>
          <span style="color: #00f0ff;">${orgName}</span> vous invite à ramer !
        </h2>
        <p style="margin-bottom: 18px; color: #cbd5e1; font-size: 15px;">
          ${params.isDuel
            ? `Vous avez été défié(e) en duel direct 1 contre 1 sur <strong>Rower Race</strong>.`
            : `Vous êtes convié(e) à prendre le départ d'une régate privée multijoueur sur <strong>Rower Race</strong>.`
          }
        </p>

        <!-- CARTE RÉCAPITULATIF COURSE & CODES -->
        <div style="background-color: #0d1527; border: 1px solid rgba(0, 240, 255, 0.25); border-radius: 8px; padding: 18px; margin: 20px 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="padding-bottom: 10px;">
                <span style="font-size: 12px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px;">Nom de la course :</span>
                <div style="font-size: 17px; font-weight: bold; color: #ffffff; margin-top: 2px;">${params.roomTitle}</div>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom: 12px;">
                <span style="font-size: 12px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px;">Distance officielle :</span>
                <div style="font-size: 16px; font-weight: bold; color: #00f0ff; margin-top: 2px;">${params.targetDistance} mètres</div>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.08);">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td width="50%" style="vertical-align: top;">
                      <div style="font-size: 11px; text-transform: uppercase; color: #94a3b8;">Code Salon Web</div>
                      <div style="font-size: 18px; font-weight: bold; color: #00f0ff; font-family: monospace; letter-spacing: 1px;">${params.roomCode}</div>
                    </td>
                    <td width="50%" style="vertical-align: top;">
                      <div style="font-size: 11px; text-transform: uppercase; color: #94a3b8;">Code Montre Garmin</div>
                      <div style="font-size: 18px; font-weight: bold; color: #ffe600; font-family: monospace; letter-spacing: 2px;">${params.roomPin}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </div>

        ${scheduleSectionHtml}

        <!-- GUIDE ET INSTRUCTIONS APPAIRAGE MONTRE GARMIN (CONNECT IQ STORE) -->
        <div style="background-color: #0b1528; border: 1px solid rgba(0, 240, 255, 0.35); border-radius: 8px; padding: 18px; margin: 24px 0;">
          <div style="display: flex; align-items: center; margin-bottom: 12px;">
            <span style="font-size: 20px; margin-right: 8px;">⌚</span>
            <span style="font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #00f0ff;">
              Comment participer avec votre montre Garmin ?
            </span>
          </div>
          <ol style="margin: 0; padding-left: 20px; color: #cbd5e1; font-size: 14px; line-height: 1.6;">
            <li style="margin-bottom: 10px;">
              <strong>Installez l'application Rower Race</strong> : Depuis l'application Garmin (application Garmin Connect IQ) ou depuis le web sur <a href="https://apps.garmin.com" style="color: #00f0ff; text-decoration: underline;">apps.garmin.com</a>, recherchez et installez l'application <strong>« Rower Race »</strong> sur votre montre connectée Garmin.
            </li>
            <li style="margin-bottom: 10px;">
              <strong>Ouvrez l'application</strong> sur votre montre Garmin à proximité de votre rameur (Concept2 PM5, WaterRower, SmartRow ou ergomètre FTMS).
            </li>
            <li style="margin-bottom: 10px;">
              <strong>Rejoignez la course</strong> : Dans le menu principal de la montre, sélectionnez <strong>« Rejoindre un salon »</strong> (ou « Code Salon ») et saisissez le code montre : <span style="background-color: #131c31; border: 1px solid #ffe600; color: #ffe600; font-family: monospace; font-weight: bold; padding: 2px 8px; border-radius: 4px; font-size: 15px; letter-spacing: 1px;">${params.roomPin}</span>.
            </li>
            <li style="margin-bottom: 4px;">
              <strong>Prenez le départ !</strong> Vos capteurs (cadence, puissance en Watts, allure au 500m et fréquence cardiaque) se synchronisent automatiquement en direct sur le plan d'eau virtuel.
            </li>
          </ol>
        </div>

        <!-- OPTION NAVIGATION WEB -->
        <div style="background-color: rgba(255, 255, 255, 0.03); border-left: 3px solid #00f0ff; padding: 12px 16px; margin: 18px 0; border-radius: 4px; font-size: 13px; color: #cbd5e1; line-height: 1.5;">
          💻 <strong>Participer depuis votre ordinateur ou tablette :</strong> Cliquez sur le bouton ci-dessous pour entrer directement sur la ligne de départ, ou ouvrez l'adresse <a href="${canonicalJoinUrl}" style="color: #00f0ff; text-decoration: underline;">${canonicalJoinUrl}</a>.
        </div>
      `;

      text = `Bonjour,\n\n${orgName} vous invite à une course connectée Rower Race !\n\nCourse : ${params.roomTitle}\nDistance : ${params.targetDistance}m\n${scheduleSectionText}\nLien direct canonique : ${canonicalJoinUrl}\nCode Salon Web : ${params.roomCode}\nCode Montre Garmin : ${params.roomPin}\n\nCOMMENT PARTICIPER AVEC VOTRE MONTRE GARMIN :\n1. Installez l'application 'Rower Race' depuis l'application Garmin (Garmin Connect IQ ou apps.garmin.com).\n2. Ouvrez l'application sur votre montre Garmin à proximité de votre rameur (Concept2 PM5, WaterRower, SmartRow ou ergomètre FTMS).\n3. Dans le menu, sélectionnez 'Rejoindre un salon' et saisissez le code montre : ${params.roomPin}\n4. Vos métriques (Watts, cadence, allure /500m, FC) seront transmises en direct.\n\nSportivement,\nL'équipe Rower Race`;
    } else {
      // VERSION ANGLAISE (PAR DÉFAUT SI NON FRANCOPHONE)
      const modeBadge = params.isDuel ? "⚔️ 1 vs 1 Duel" : "🚣 Multiplayer Regatta";
      subject = params.isDuel
        ? `⚔️ Rower Race - 1v1 Duel Invitation from ${orgName}`
        : `🚣 Rower Race - Invitation to "${params.roomTitle}" by ${orgName}`;
      preheader = `${orgName} invites you to race in ${params.roomTitle} (${params.targetDistance}m)`;
      ctaText = "Join the Regatta";
      securityNote = `This room is private and secure. Your direct access link: ${canonicalJoinUrl}`;

      bodyContentHtml = `
        <div style="display: inline-block; background-color: rgba(0, 240, 255, 0.12); border: 1px solid #00f0ff; color: #00f0ff; font-size: 12px; font-weight: bold; text-transform: uppercase; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; letter-spacing: 1px;">
          ${modeBadge}
        </div>
        <h2 style="color: #ffffff; font-size: 22px; margin-top: 0; margin-bottom: 14px; line-height: 1.3;">
          Hello,<br>
          <span style="color: #00f0ff;">${orgName}</span> invites you to row!
        </h2>
        <p style="margin-bottom: 18px; color: #cbd5e1; font-size: 15px;">
          ${params.isDuel
            ? `You have been challenged to a head-to-head 1v1 duel on <strong>Rower Race</strong>.`
            : `You are invited to join the starting line of a private multiplayer regatta on <strong>Rower Race</strong>.`
          }
        </p>

        <!-- RACE SUMMARY & CODES CARD -->
        <div style="background-color: #0d1527; border: 1px solid rgba(0, 240, 255, 0.25); border-radius: 8px; padding: 18px; margin: 20px 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="padding-bottom: 10px;">
                <span style="font-size: 12px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px;">Race Name:</span>
                <div style="font-size: 17px; font-weight: bold; color: #ffffff; margin-top: 2px;">${params.roomTitle}</div>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom: 12px;">
                <span style="font-size: 12px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px;">Official Distance:</span>
                <div style="font-size: 16px; font-weight: bold; color: #00f0ff; margin-top: 2px;">${params.targetDistance} meters</div>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.08);">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td width="50%" style="vertical-align: top;">
                      <div style="font-size: 11px; text-transform: uppercase; color: #94a3b8;">Web Room Code</div>
                      <div style="font-size: 18px; font-weight: bold; color: #00f0ff; font-family: monospace; letter-spacing: 1px;">${params.roomCode}</div>
                    </td>
                    <td width="50%" style="vertical-align: top;">
                      <div style="font-size: 11px; text-transform: uppercase; color: #94a3b8;">Garmin Watch Code</div>
                      <div style="font-size: 18px; font-weight: bold; color: #ffe600; font-family: monospace; letter-spacing: 2px;">${params.roomPin}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </div>

        ${scheduleSectionHtml}

        <!-- HOW TO JOIN WITH GARMIN WATCH (CONNECT IQ STORE INSTRUCTIONS) -->
        <div style="background-color: #0b1528; border: 1px solid rgba(0, 240, 255, 0.35); border-radius: 8px; padding: 18px; margin: 24px 0;">
          <div style="display: flex; align-items: center; margin-bottom: 12px;">
            <span style="font-size: 20px; margin-right: 8px;">⌚</span>
            <span style="font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #00f0ff;">
              How to join with your Garmin watch?
            </span>
          </div>
          <ol style="margin: 0; padding-left: 20px; color: #cbd5e1; font-size: 14px; line-height: 1.6;">
            <li style="margin-bottom: 10px;">
              <strong>Install the Rower Race app</strong>: From the Garmin app (Garmin Connect IQ app) or via the web at <a href="https://apps.garmin.com" style="color: #00f0ff; text-decoration: underline;">apps.garmin.com</a>, search for and install <strong>"Rower Race"</strong> on your Garmin watch.
            </li>
            <li style="margin-bottom: 10px;">
              <strong>Open the app</strong> on your Garmin watch near your rowing machine (Concept2 PM5, WaterRower, SmartRow, or FTMS ergometer).
            </li>
            <li style="margin-bottom: 10px;">
              <strong>Join the room</strong>: In the watch menu, select <strong>"Join Room"</strong> (or "Room Code") and enter your watch code: <span style="background-color: #131c31; border: 1px solid #ffe600; color: #ffe600; font-family: monospace; font-weight: bold; padding: 2px 8px; border-radius: 4px; font-size: 15px; letter-spacing: 1px;">${params.roomPin}</span>.
            </li>
            <li style="margin-bottom: 4px;">
              <strong>Ready to row!</strong> Your sensors (stroke rate, power in Watts, 500m split pace, and heart rate) will broadcast in real-time to the live regatta track.
            </li>
          </ol>
        </div>

        <!-- WEB BROWSER OPTION -->
        <div style="background-color: rgba(255, 255, 255, 0.03); border-left: 3px solid #00f0ff; padding: 12px 16px; margin: 18px 0; border-radius: 4px; font-size: 13px; color: #cbd5e1; line-height: 1.5;">
          💻 <strong>Join via Web Browser:</strong> Click the button below to open the starting line directly, or navigate to <a href="${canonicalJoinUrl}" style="color: #00f0ff; text-decoration: underline;">${canonicalJoinUrl}</a>.
        </div>
      `;

      text = `Hello,\n\n${orgName} invites you to a connected race on Rower Race!\n\nRace: ${params.roomTitle}\nDistance: ${params.targetDistance}m\n${scheduleSectionText}\nDirect room link: ${canonicalJoinUrl}\nWeb Room Code: ${params.roomCode}\nGarmin Watch Code: ${params.roomPin}\n\nHOW TO JOIN WITH YOUR GARMIN WATCH:\n1. Install the 'Rower Race' app from the Garmin app (Garmin Connect IQ or apps.garmin.com).\n2. Open the app on your Garmin watch near your rowing machine (Concept2 PM5, WaterRower, SmartRow, or FTMS ergometer).\n3. In the menu, select 'Join Room' and enter your watch code: ${params.roomPin}\n4. Your metrics (Watts, stroke rate, 500m pace, HR) will stream live to the race.\n\nBest regards,\nThe Rower Race Team`;
    }

    const html = renderCyberEmailHtml({
      title: subject,
      preheader,
      bodyContentHtml,
      ctaText,
      ctaUrl: canonicalJoinUrl,
      securityNote,
      lang,
    });

    const attachments: EmailAttachment[] = [];
    if (params.icsCalendarContent) {
      attachments.push({
        filename: `invitation-regate-${params.roomCode}.ics`,
        content: Buffer.from(params.icsCalendarContent, "utf-8").toString("base64"),
        type: "text/calendar",
      });
    }

    const res = await this.sendEmail({
      to: params.to,
      subject,
      text,
      html,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    return res.success;
  }

  /**
   * Envoi d'un courriel de confirmation de souscription à un abonnement payant (Club ou Élite Pro)
   */
  public async sendSubscriptionConfirmationEmail(
    to: string,
    userName: string,
    planName: string,
    priceFormatted: string,
    nextBillingDate?: string,
    lang: string = "fr"
  ): Promise<boolean> {
    const config = getEmailConfig();
    const isFr = (lang || "fr").toLowerCase().startsWith("fr");
    const displayName = (userName || (isFr ? "Rameur" : "Rower")).trim();

    if (isFr) {
      const subject = `🚣 Rower Race - Confirmation de votre abonnement ${planName}`;
      const isPro = planName.toLowerCase().includes("élite") || planName.toLowerCase().includes("pro");
      const perksHtml = isPro
        ? `
          <li style="margin-bottom: 8px;"><strong>Salons privés jusqu'à 10 coureurs</strong> et <strong>10 000 m (10 km)</strong>.</li>
          <li style="margin-bottom: 8px;"><strong>Jusqu'à 5 bots virtuels</strong> avec régulation d'allure avancée.</li>
          <li style="margin-bottom: 8px;"><strong>Historique et analyses statistiques illimités</strong> avec export de données.</li>
          <li style="margin-bottom: 8px;"><strong>Planification de courses à l'heure</strong> et accès prioritaire aux nouveautés.</li>
        `
        : `
          <li style="margin-bottom: 8px;"><strong>Salons privés jusqu'à 5 coureurs</strong> et <strong>5 000 m (5 km)</strong>.</li>
          <li style="margin-bottom: 8px;"><strong>Jusqu'à 3 bots virtuels</strong> d'entraînement configurables.</li>
          <li style="margin-bottom: 8px;"><strong>Historique et analyses statistiques illimités</strong> de vos courses.</li>
          <li style="margin-bottom: 8px;"><strong>Départ instantané ou programmé à l'heure</strong>.</li>
        `;

      const billingInfo = nextBillingDate
        ? `<p style="margin-top: 16px; font-size: 13px; color: #94a3b8;">Votre prochain renouvellement mensuel interviendra le <strong>${nextBillingDate}</strong>.</p>`
        : `<p style="margin-top: 16px; font-size: 13px; color: #94a3b8;">Abonnement mensuel renouvelable automatiquement sans engagement de durée.</p>`;

      const bodyContentHtml = `
        <div style="display: inline-block; background-color: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; color: #10b981; font-size: 12px; font-weight: bold; text-transform: uppercase; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; letter-spacing: 1px;">
          ✓ Abonnement Activé
        </div>
        <h2 style="color: #ffffff; font-size: 22px; margin-top: 0; margin-bottom: 14px;">
          Félicitations <span style="color: #00f0ff;">${displayName}</span> !
        </h2>
        <p style="margin-bottom: 16px; color: #cbd5e1; font-size: 15px;">
          Nous vous confirmons l'activation immédiate de votre abonnement <strong>${planName}</strong> (${priceFormatted}).
        </p>

        <div style="background-color: #0d1527; border: 1px solid rgba(0, 240, 255, 0.3); border-radius: 8px; padding: 18px; margin: 20px 0;">
          <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #00f0ff; font-weight: bold; margin-bottom: 10px;">
            Vos avantages débloqués :
          </div>
          <ul style="padding-left: 20px; margin: 0; color: #cbd5e1; font-size: 14px; line-height: 1.6;">
            ${perksHtml}
          </ul>
        </div>

        ${billingInfo}
        <p style="margin-bottom: 12px; font-size: 13px; color: #94a3b8;">
          Vous pouvez gérer vos coordonnées de paiement ou résilier à tout moment en un simple clic depuis votre espace « Mon Compte » ou sur votre portail client sécurisé Stripe.
        </p>
      `;

      const html = renderCyberEmailHtml({
        title: subject,
        preheader: `Votre abonnement ${planName} est activé sur Rower Race !`,
        bodyContentHtml,
        ctaText: "Accéder à la plateforme",
        ctaUrl: config.frontendUrl,
        securityNote: "Votre paiement a été traité de manière sécurisée par Stripe Payments (certifié PCI-DSS Niveau 1). Aucun numéro de carte n'est stocké sur nos serveurs.",
        lang: "fr",
      });

      const text = `Bonjour ${displayName},\n\nNous vous confirmons l'activation de votre abonnement ${planName} (${priceFormatted}) sur Rower Race !\n\nVos nouveaux avantages sont immédiatement accessibles sur la plateforme : ${config.frontendUrl}\n\nVous pouvez gérer votre abonnement à tout moment depuis votre profil.\n\nSportivement,\nL'équipe Rower Race`;

      const res = await this.sendEmail({ to, subject, text, html });
      return res.success;
    } else {
      const subject = `🚣 Rower Race - Subscription Confirmed: ${planName}`;
      const isPro = planName.toLowerCase().includes("élite") || planName.toLowerCase().includes("pro");
      const perksHtml = isPro
        ? `
          <li style="margin-bottom: 8px;"><strong>Private rooms up to 10 athletes</strong> and <strong>10,000 m (10 km)</strong>.</li>
          <li style="margin-bottom: 8px;"><strong>Up to 5 virtual training bots</strong> with advanced pacing.</li>
          <li style="margin-bottom: 8px;"><strong>Unlimited race history and analytics</strong> with data export.</li>
          <li style="margin-bottom: 8px;"><strong>Scheduled start times</strong> and priority feature access.</li>
        `
        : `
          <li style="margin-bottom: 8px;"><strong>Private rooms up to 5 athletes</strong> and <strong>5,000 m (5 km)</strong>.</li>
          <li style="margin-bottom: 8px;"><strong>Up to 3 configurable virtual bots</strong>.</li>
          <li style="margin-bottom: 8px;"><strong>Unlimited race history and analytics</strong>.</li>
          <li style="margin-bottom: 8px;"><strong>Instant or scheduled race starts</strong>.</li>
        `;

      const billingInfo = nextBillingDate
        ? `<p style="margin-top: 16px; font-size: 13px; color: #94a3b8;">Your next billing renewal date is <strong>${nextBillingDate}</strong>.</p>`
        : `<p style="margin-top: 16px; font-size: 13px; color: #94a3b8;">Monthly recurring subscription with no commitment.</p>`;

      const bodyContentHtml = `
        <div style="display: inline-block; background-color: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; color: #10b981; font-size: 12px; font-weight: bold; text-transform: uppercase; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; letter-spacing: 1px;">
          ✓ Subscription Active
        </div>
        <h2 style="color: #ffffff; font-size: 22px; margin-top: 0; margin-bottom: 14px;">
          Congratulations <span style="color: #00f0ff;">${displayName}</span>!
        </h2>
        <p style="margin-bottom: 16px; color: #cbd5e1; font-size: 15px;">
          We confirm the immediate activation of your <strong>${planName}</strong> plan (${priceFormatted}).
        </p>

        <div style="background-color: #0d1527; border: 1px solid rgba(0, 240, 255, 0.3); border-radius: 8px; padding: 18px; margin: 20px 0;">
          <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #00f0ff; font-weight: bold; margin-bottom: 10px;">
            Unlocked Benefits:
          </div>
          <ul style="padding-left: 20px; margin: 0; color: #cbd5e1; font-size: 14px; line-height: 1.6;">
            ${perksHtml}
          </ul>
        </div>

        ${billingInfo}
        <p style="margin-bottom: 12px; font-size: 13px; color: #94a3b8;">
          You can manage your payment details or cancel anytime from "My Account" or your secure Stripe customer portal.
        </p>
      `;

      const html = renderCyberEmailHtml({
        title: subject,
        preheader: `Your ${planName} subscription is active on Rower Race!`,
        bodyContentHtml,
        ctaText: "Open Platform",
        ctaUrl: config.frontendUrl,
        securityNote: "Payment securely processed via Stripe Payments (PCI-DSS Level 1 certified).",
        lang: "en",
      });

      const text = `Hello ${displayName},\n\nYour subscription to ${planName} (${priceFormatted}) is active on Rower Race!\n\nAccess your new benefits now: ${config.frontendUrl}\n\nBest regards,\nThe Rower Race Team`;

      const res = await this.sendEmail({ to, subject, text, html });
      return res.success;
    }
  }

  /**
   * Envoi d'un courriel de confirmation de clôture / résiliation d'un abonnement
   */
  public async sendSubscriptionCancellationEmail(
    to: string,
    userName: string,
    planName: string,
    effectiveDate?: string,
    lang: string = "fr"
  ): Promise<boolean> {
    const config = getEmailConfig();
    const isFr = (lang || "fr").toLowerCase().startsWith("fr");
    const displayName = (userName || (isFr ? "Rameur" : "Rower")).trim();

    if (isFr) {
      const subject = `Rower Race - Confirmation de résiliation de votre abonnement`;
      const dateNote = effectiveDate
        ? `<p style="margin-bottom: 16px;">Votre résiliation prendra effet le <strong>${effectiveDate}</strong>, à l'issue de votre période mensuelle déjà réglée.</p>`
        : `<p style="margin-bottom: 16px;">Votre résiliation a bien été prise en compte et aucun prélèvement ultérieur ne sera effectué.</p>`;

      const bodyContentHtml = `
        <div style="display: inline-block; background-color: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; color: #f59e0b; font-size: 12px; font-weight: bold; text-transform: uppercase; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; letter-spacing: 1px;">
          ℹ️ Clôture d'Abonnement
        </div>
        <h2 style="color: #ffffff; font-size: 22px; margin-top: 0; margin-bottom: 14px;">
          Bonjour <span style="color: #00f0ff;">${displayName}</span>,
        </h2>
        <p style="margin-bottom: 16px; color: #cbd5e1; font-size: 15px;">
          Nous vous confirmons la résiliation de votre abonnement <strong>${planName}</strong> sur Rower Race.
        </p>

        ${dateNote}

        <div style="background-color: #0d1527; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 18px; margin: 20px 0;">
          <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; font-weight: bold; margin-bottom: 8px;">
            Ce qui change pour votre compte :
          </div>
          <ul style="padding-left: 20px; margin: 0; color: #cbd5e1; font-size: 14px; line-height: 1.6;">
            <li style="margin-bottom: 6px;"><strong>Vous conservez votre compte :</strong> vos identifiants et votre appairage Garmin restent actifs.</li>
            <li style="margin-bottom: 6px;"><strong>Passage automatique en Offre Gratuite :</strong> vous continuez d'accéder aux courses et à vos 10 derniers jours de statistiques.</li>
            <li style="margin-bottom: 6px;"><strong>Aucun engagement :</strong> vous pouvez vous réabonner à tout moment pour retrouver vos quotas illimités.</li>
          </ul>
        </div>
      `;

      const html = renderCyberEmailHtml({
        title: subject,
        preheader: `Votre résiliation d'abonnement ${planName} a bien été enregistrée.`,
        bodyContentHtml,
        ctaText: "Accéder à mon compte",
        ctaUrl: config.frontendUrl,
        securityNote: "Votre abonnement récurrent auprès de Stripe a été clôturé. Aucun prélèvement futur ne sera effectué.",
        lang: "fr",
      });

      const text = `Bonjour ${displayName},\n\nNous vous confirmons la résiliation de votre abonnement ${planName}.\nVotre compte reste actif sous la formule gratuite, et aucun prélèvement ultérieur ne sera effectué.\n\nAccéder à votre compte : ${config.frontendUrl}\n\nSportivement,\nL'équipe Rower Race`;

      const res = await this.sendEmail({ to, subject, text, html });
      return res.success;
    } else {
      const subject = `Rower Race - Subscription Cancellation Confirmation`;
      const dateNote = effectiveDate
        ? `<p style="margin-bottom: 16px;">Your cancellation will take effect on <strong>${effectiveDate}</strong>, at the end of your already paid billing cycle.</p>`
        : `<p style="margin-bottom: 16px;">Your cancellation has been processed and no further charges will occur.</p>`;

      const bodyContentHtml = `
        <div style="display: inline-block; background-color: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; color: #f59e0b; font-size: 12px; font-weight: bold; text-transform: uppercase; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; letter-spacing: 1px;">
          ℹ️ Subscription Cancellation
        </div>
        <h2 style="color: #ffffff; font-size: 22px; margin-top: 0; margin-bottom: 14px;">
          Hello <span style="color: #00f0ff;">${displayName}</span>,
        </h2>
        <p style="margin-bottom: 16px; color: #cbd5e1; font-size: 15px;">
          We confirm the cancellation of your <strong>${planName}</strong> plan on Rower Race.
        </p>

        ${dateNote}

        <div style="background-color: #0d1527; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 18px; margin: 20px 0;">
          <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; font-weight: bold; margin-bottom: 8px;">
            Account Changes:
          </div>
          <ul style="padding-left: 20px; margin: 0; color: #cbd5e1; font-size: 14px; line-height: 1.6;">
            <li style="margin-bottom: 6px;"><strong>Your account remains active:</strong> your credentials and Garmin pairing are preserved.</li>
            <li style="margin-bottom: 6px;"><strong>Automatic switch to Free Tier:</strong> you retain access to public races and your last 10 days of stats.</li>
            <li style="margin-bottom: 6px;"><strong>No commitment:</strong> you can resubscribe anytime to regain unlimited quotas.</li>
          </ul>
        </div>
      `;

      const html = renderCyberEmailHtml({
        title: subject,
        preheader: `Your subscription cancellation for ${planName} is confirmed.`,
        bodyContentHtml,
        ctaText: "Go to My Account",
        ctaUrl: config.frontendUrl,
        securityNote: "Your Stripe recurring subscription has ended. No further charges will be made.",
        lang: "en",
      });

      const text = `Hello ${displayName},\n\nWe confirm the cancellation of your ${planName} subscription.\nYour account remains active on the free plan, with no further charges.\n\nAccount: ${config.frontendUrl}\n\nBest regards,\nThe Rower Race Team`;

      const res = await this.sendEmail({ to, subject, text, html });
      return res.success;
    }
  }

  /**
   * Envoi d'un courriel de confirmation de fermeture et suppression définitive d'un compte (RGPD Art. 17)
   */
  public async sendAccountClosureEmail(to: string, userName: string, lang: string = "fr"): Promise<boolean> {
    const config = getEmailConfig();
    const isFr = (lang || "fr").toLowerCase().startsWith("fr");
    const displayName = (userName || (isFr ? "Rameur" : "Rower")).trim();

    if (isFr) {
      const subject = `Rower Race - Confirmation de fermeture définitive de votre compte`;
      const bodyContentHtml = `
        <div style="display: inline-block; background-color: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; font-size: 12px; font-weight: bold; text-transform: uppercase; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; letter-spacing: 1px;">
          ✕ Compte Fermé
        </div>
        <h2 style="color: #ffffff; font-size: 22px; margin-top: 0; margin-bottom: 14px;">
          Au revoir <span style="color: #00f0ff;">${displayName}</span>,
        </h2>
        <p style="margin-bottom: 16px; color: #cbd5e1; font-size: 15px;">
          Nous vous confirmons la suppression définitive de votre compte utilisateur <strong>Rower Race</strong> ainsi que la purge complète de l'ensemble de vos données associées, conformément à l'article 17 du RGPD (Droit à l'effacement).
        </p>

        <div style="background-color: #0d1527; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 18px; margin: 20px 0;">
          <ul style="padding-left: 20px; margin: 0; color: #cbd5e1; font-size: 14px; line-height: 1.6;">
            <li style="margin-bottom: 8px;"><strong>Abonnements clôturés :</strong> tout abonnement récurrent en cours a été immédiatement résilié et ne fera l'objet d'aucun prélèvement ultérieur.</li>
            <li style="margin-bottom: 8px;"><strong>Purge des données :</strong> votre historique de courses, données télémétriques, appairages de montres Garmin et identifiants ont été effacés de manière irréversible.</li>
          </ul>
        </div>

        <p style="margin-bottom: 12px; color: #94a3b8; font-size: 14px;">
          Nous vous remercions sincèrement pour l'ensemble des courses et coups de rame partagés au sein de la communauté. Si vous souhaitez reprendre les régates à l'avenir, vous pourrez créer un nouveau compte à tout moment.
        </p>
      `;

      const html = renderCyberEmailHtml({
        title: subject,
        preheader: `Votre compte Rower Race et vos données ont été définitivement supprimés.`,
        bodyContentHtml,
        securityNote: "Conformité RGPD Art. 17 respectée. Cette action est irréversible et vos données ont été purgées de nos serveurs.",
        lang: "fr",
      });

      const text = `Bonjour ${displayName},\n\nNous vous confirmons la fermeture définitive de votre compte Rower Race et la suppression irréversible de l'ensemble de vos données sportives et personnelles (RGPD Art. 17).\nTous vos abonnements ont été immédiatement résiliés sans prélèvement ultérieur.\n\nMerci pour votre parcours sportif à nos côtés,\nL'équipe Rower Race`;

      const res = await this.sendEmail({ to, subject, text, html });
      return res.success;
    } else {
      const subject = `Rower Race - Confirmation of Permanent Account Closure`;
      const bodyContentHtml = `
        <div style="display: inline-block; background-color: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; font-size: 12px; font-weight: bold; text-transform: uppercase; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; letter-spacing: 1px;">
          ✕ Account Closed
        </div>
        <h2 style="color: #ffffff; font-size: 22px; margin-top: 0; margin-bottom: 14px;">
          Farewell <span style="color: #00f0ff;">${displayName}</span>,
        </h2>
        <p style="margin-bottom: 16px; color: #cbd5e1; font-size: 15px;">
          We confirm the permanent deletion of your <strong>Rower Race</strong> user account and the complete erasure of all associated data, pursuant to Article 17 of GDPR (Right to erasure).
        </p>

        <div style="background-color: #0d1527; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 18px; margin: 20px 0;">
          <ul style="padding-left: 20px; margin: 0; color: #cbd5e1; font-size: 14px; line-height: 1.6;">
            <li style="margin-bottom: 8px;"><strong>Subscriptions terminated:</strong> any recurring plan has been immediately cancelled with no further charges.</li>
            <li style="margin-bottom: 8px;"><strong>Data purge:</strong> race history, telemetry, Garmin watch pairings, and credentials have been permanently deleted.</li>
          </ul>
        </div>

        <p style="margin-bottom: 12px; color: #94a3b8; font-size: 14px;">
          We thank you for rowing with our global community. Should you wish to compete again in the future, you may register a new account at any time.
        </p>
      `;

      const html = renderCyberEmailHtml({
        title: subject,
        preheader: `Your Rower Race account and data have been permanently deleted.`,
        bodyContentHtml,
        securityNote: "GDPR Art. 17 compliant. This action is irreversible.",
        lang: "en",
      });

      const text = `Hello ${displayName},\n\nWe confirm the permanent deletion of your Rower Race account and personal data (GDPR Art. 17).\nAll subscriptions have been cancelled with no further charges.\n\nThank you for rowing with us,\nThe Rower Race Team`;

      const res = await this.sendEmail({ to, subject, text, html });
      return res.success;
    }
  }

  public getSentEmails(): EmailPayload[] {
    return [...this.sentEmailsLog];
  }

  public clearLog(): void {
    this.sentEmailsLog = [];
  }
}

export default EmailService.getInstance();
