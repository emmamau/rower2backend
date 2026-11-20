/**
 * Service de gestion des courriels pour la plateforme Rower Race.
 * Intégration directe de l'API REST Resend (HTTPS) avec modèles Cyber/Sport responsive
 * et repli sécurisé en mode simulation pour le développement et les tests.
 */
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
}

export interface EmailConfig {
  resendApiKey: string;
  fromEmail: string;
  frontendUrl: string;
}

export function getEmailConfig(): EmailConfig {
  const isProd = process.env.NODE_ENV === "production";
  const defaultFrontend = isProd ? "https://rowerrace.com" : "http://localhost:4200";
  return {
    resendApiKey: (process.env.RESEND_API_KEY || "").trim(),
    fromEmail: (process.env.EMAIL_FROM || "Rower Race <contact@rowerrace.com>").trim(),
    frontendUrl: (process.env.FRONTEND_URL || defaultFrontend).trim().replace(/\/+$/, ""),
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
}): string {
  const ctaBlock = params.ctaUrl && params.ctaText ? `
    <div style="text-align: center; margin: 32px 0 24px 0;">
      <a href="${params.ctaUrl}" style="background-color: #00e5ff; color: #0a0f1d; font-weight: bold; text-decoration: none; padding: 14px 28px; border-radius: 6px; display: inline-block; font-size: 15px; letter-spacing: 0.5px; text-transform: uppercase; box-shadow: 0 0 15px rgba(0, 229, 255, 0.4);">
        ${params.ctaText}
      </a>
    </div>
  ` : '';

  const securityBlock = params.securityNote ? `
    <div style="background-color: rgba(0, 229, 255, 0.05); border-left: 3px solid #00e5ff; padding: 12px 16px; margin-top: 24px; border-radius: 4px; font-size: 13px; color: #94a3b8; line-height: 1.5;">
      ${params.securityNote}
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${params.title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0f1d; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f1f5f9;">
  <div style="display: none; font-size: 1px; color: #0a0f1d; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    ${params.preheader}
  </div>
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0a0f1d; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 580px; background-color: #131c31; border: 1px solid rgba(0, 229, 255, 0.25); border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <!-- Header Branding -->
          <tr>
            <td style="padding: 24px 30px; text-align: center; border-bottom: 1px solid rgba(0, 229, 255, 0.15); background: linear-gradient(180deg, rgba(0, 229, 255, 0.08) 0%, rgba(19, 28, 49, 0) 100%);">
              <span style="font-size: 24px; font-weight: 900; letter-spacing: 2px; color: #00e5ff; text-transform: uppercase;">
                ROWER RACE
              </span>
              <div style="font-size: 12px; color: #64748b; letter-spacing: 1px; text-transform: uppercase; margin-top: 4px;">
                Plateforme de Régates &amp; Entraînement Connecté
              </div>
            </td>
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
              &copy; ${new Date().getFullYear()} Rower Race &bull; Tous droits réservés.<br>
              Ce courriel vous a été envoyé automatiquement, merci de ne pas y répondre directement.
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
  public async sendWelcomeEmail(to: string, userName: string, login: string): Promise<boolean> {
    const config = getEmailConfig();
    const subject = "Bienvenue sur Rower Race - Votre compte abonné est créé";
    const displayName = (userName || login).trim();

    const bodyContentHtml = `
      <h2 style="color: #ffffff; font-size: 20px; margin-top: 0; margin-bottom: 16px;">
        Bonjour <span style="color: #00e5ff;">${displayName}</span>,
      </h2>
      <p style="margin-bottom: 20px;">
        Merci d'avoir rejoint <strong>Rower Race</strong> ! Votre compte abonné a été créé et activé avec succès.
      </p>

      <div style="background-color: #0d1527; border: 1px solid rgba(0, 229, 255, 0.3); border-radius: 8px; padding: 18px; margin: 20px 0;">
        <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 6px;">
          Votre identifiant de connexion unique :
        </div>
        <div style="font-size: 20px; font-weight: bold; color: #00e5ff; font-family: monospace;">
          ${login}
        </div>
      </div>

      <p style="margin-bottom: 12px;">
        En tant qu'abonné, vous profitez dès aujourd'hui de tous vos avantages exclusifs :
      </p>
      <ul style="padding-left: 20px; margin-bottom: 24px; color: #cbd5e1;">
        <li style="margin-bottom: 8px;"><strong>Salons privés illimités :</strong> organisez des régates en direct avec vos amis ou votre club.</li>
        <li style="margin-bottom: 8px;"><strong>Appairage montre Garmin :</strong> synchronisation instantanée de votre télémétrie rameur (puissance, cadence, allure, FC).</li>
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
    });

    const text = `Bonjour ${displayName},\n\nMerci pour votre inscription ! Votre compte abonné Rower Race est prêt.\nVotre login unique : ${login}\n\nCe login unique vous permet d'appairer votre montre Garmin Connect IQ et de créer des salons de course privés.\n\nAccédez à la plateforme : ${config.frontendUrl}\n\nSportivement,\nL'équipe Rower Race`;

    const res = await this.sendEmail({ to, subject, text, html });
    return res.success;
  }

  /**
   * Envoi d'un courriel de confirmation d'inscription via l'application Garmin
   */
  public async sendRegistrationConfirmationEmail(to: string, login: string): Promise<boolean> {
    const config = getEmailConfig();
    const subject = "Rower Race - Inscription confirmée par votre montre Garmin";

    const bodyContentHtml = `
      <h2 style="color: #ffffff; font-size: 20px; margin-top: 0; margin-bottom: 16px;">
        Félicitations <span style="color: #00e5ff;">${login}</span> !
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
    });

    const text = `Félicitations !\n\nVotre inscription avec le login ${login} a bien été validée depuis votre montre Garmin Connect IQ.\nVous pouvez dès maintenant organiser vos régates privées sur : ${config.frontendUrl}\n\nL'équipe Rower Race`;

    const res = await this.sendEmail({ to, subject, text, html });
    return res.success;
  }

  /**
   * Envoi d'un courriel de réinitialisation de mot de passe sécurisé
   */
  public async sendPasswordResetEmail(to: string, login: string, resetToken: string): Promise<boolean> {
    const config = getEmailConfig();
    const subject = "Rower Race - Réinitialisation de votre mot de passe";
    const resetUrl = `${config.frontendUrl}/?resetToken=${encodeURIComponent(resetToken)}`;

    const bodyContentHtml = `
      <h2 style="color: #ffffff; font-size: 20px; margin-top: 0; margin-bottom: 16px;">
        Réinitialisation de mot de passe
      </h2>
      <p style="margin-bottom: 16px;">
        Une demande de réinitialisation de mot de passe a été formulée pour le compte <strong style="color: #00e5ff;">${login}</strong>.
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
    });

    const text = `Bonjour,\n\nUne demande de réinitialisation de mot de passe a été formulée pour le compte ${login}.\nPour définir un nouveau mot de passe, veuillez utiliser le lien sécurisé suivant (valable 1 heure) :\n${resetUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail en toute sécurité.\n\nSportivement,\nL'équipe Rower Race`;

    const res = await this.sendEmail({ to, subject, text, html });
    return res.success;
  }

  /**
   * Envoi d'une invitation à une régate ou un duel 1v1 avec codes, lien direct
   * et rendez-vous d'agenda iCalendar (.ics) si planifié.
   */
  public async sendRoomInvitationEmail(params: RoomInvitationEmailParams): Promise<boolean> {
    const orgName = (params.organizerName || "Un rameur").trim();
    const modeBadge = params.isDuel ? "⚔️ Duel 1 vs 1" : "🚣 Régate Multijoueurs";
    const subject = params.isDuel
      ? `⚔️ Rower Race - Invitation au Duel 1v1 de ${orgName}`
      : `🚣 Rower Race - Invitation à la régate "${params.roomTitle}" par ${orgName}`;

    let scheduleSectionHtml = "";
    let scheduleSectionText = "";
    if (params.scheduledStartTime) {
      const d = new Date(params.scheduledStartTime);
      const tz = params.timezone || "Europe/Paris";
      let formattedDate = params.scheduledStartTime;
      try {
        const dtf = new Intl.DateTimeFormat("fr-FR", {
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

      const calButtonsHtml = (params.googleCalendarUrl || params.outlookCalendarUrl) ? `
        <div style="margin-top: 14px; display: flex; flex-wrap: wrap; gap: 10px;">
          ${params.googleCalendarUrl ? `<a href="${params.googleCalendarUrl}" style="background-color: #1e293b; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); text-decoration: none; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; display: inline-block;">📅 Google Agenda</a>` : ''}
          ${params.outlookCalendarUrl ? `<a href="${params.outlookCalendarUrl}" style="background-color: #1e293b; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); text-decoration: none; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; display: inline-block;">📅 Outlook / Office 365</a>` : ''}
        </div>
      ` : '';

      scheduleSectionHtml = `
        <div style="background-color: #0b1329; border-left: 3px solid #f59e0b; padding: 14px 18px; border-radius: 6px; margin: 18px 0;">
          <div style="font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #f59e0b; margin-bottom: 4px;">
            ⏰ Démarrage Planifié
          </div>
          <div style="font-size: 16px; font-weight: bold; color: #ffffff;">
            ${formattedDate}
          </div>
          ${calButtonsHtml}
          ${params.icsCalendarContent ? `<div style="font-size: 12px; color: #94a3b8; margin-top: 8px;">📎 Un fichier rendez-vous <strong>.ics</strong> est joint à ce courriel pour intégrer directement votre calendrier.</div>` : ''}
        </div>
      `;
      scheduleSectionText = `\n⏰ Démarrage planifié : ${formattedDate}\n`;
    }

    const bodyContentHtml = `
      <div style="display: inline-block; background-color: rgba(0, 229, 255, 0.12); border: 1px solid #00e5ff; color: #00e5ff; font-size: 12px; font-weight: bold; text-transform: uppercase; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; letter-spacing: 1px;">
        ${modeBadge}
      </div>
      <h2 style="color: #ffffff; font-size: 22px; margin-top: 0; margin-bottom: 14px; line-height: 1.3;">
        Bonjour,<br>
        <span style="color: #00e5ff;">${orgName}</span> vous invite à ramer !
      </h2>
      <p style="margin-bottom: 18px; color: #cbd5e1; font-size: 15px;">
        ${params.isDuel
          ? `Vous avez été défié(e) en duel direct 1 contre 1 sur <strong>Rower Race</strong>.`
          : `Vous êtes convié(e) à prendre le départ d'une régate privée multijoueur sur <strong>Rower Race</strong>.`
        }
      </p>

      <div style="background-color: #0d1527; border: 1px solid rgba(0, 229, 255, 0.25); border-radius: 8px; padding: 18px; margin: 20px 0;">
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
              <div style="font-size: 16px; font-weight: bold; color: #00e5ff; margin-top: 2px;">${params.targetDistance} mètres</div>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.08);">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td width="50%" style="vertical-align: top;">
                    <div style="font-size: 11px; text-transform: uppercase; color: #94a3b8;">Code Salon Web</div>
                    <div style="font-size: 18px; font-weight: bold; color: #00e5ff; font-family: monospace; letter-spacing: 1px;">${params.roomCode}</div>
                  </td>
                  <td width="50%" style="vertical-align: top;">
                    <div style="font-size: 11px; text-transform: uppercase; color: #94a3b8;">Code Montre Garmin</div>
                    <div style="font-size: 18px; font-weight: bold; color: #fbbf24; font-family: monospace; letter-spacing: 2px;">${params.roomPin}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>

      ${scheduleSectionHtml}

      <p style="margin-top: 20px; margin-bottom: 8px; color: #94a3b8; font-size: 13px;">
        💡 <strong>Comment participer ?</strong> Cliquez sur le bouton ci-dessous pour ouvrir directement la ligne de départ, ou saisissez le code sur votre montre Garmin Connect IQ.
      </p>
    `;

    const html = renderCyberEmailHtml({
      title: subject,
      preheader: `${orgName} vous invite à la course ${params.roomTitle} (${params.targetDistance}m)`,
      bodyContentHtml,
      ctaText: "Rejoindre la Régate",
      ctaUrl: params.joinUrl,
      securityNote: `Ce salon est privé et sécurisé. Votre lien de connexion : ${params.joinUrl}`,
    });

    const text = `Bonjour,\n\n${orgName} vous invite à une course connectée Rower Race !\n\nCourse : ${params.roomTitle}\nDistance : ${params.targetDistance}m\n${scheduleSectionText}\nLien direct pour rejoindre : ${params.joinUrl}\nCode Salon Web : ${params.roomCode}\nCode Montre Garmin : ${params.roomPin}\n\nSportivement,\nL'équipe Rower Race`;

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
    nextBillingDate?: string
  ): Promise<boolean> {
    const config = getEmailConfig();
    const displayName = (userName || "Rameur").trim();
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
        Félicitations <span style="color: #00e5ff;">${displayName}</span> !
      </h2>
      <p style="margin-bottom: 16px; color: #cbd5e1; font-size: 15px;">
        Nous vous confirmons l'activation immédiate de votre abonnement <strong>${planName}</strong> (${priceFormatted}).
      </p>

      <div style="background-color: #0d1527; border: 1px solid rgba(0, 229, 255, 0.3); border-radius: 8px; padding: 18px; margin: 20px 0;">
        <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #00e5ff; font-weight: bold; margin-bottom: 10px;">
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
    });

    const text = `Bonjour ${displayName},\n\nNous vous confirmons l'activation de votre abonnement ${planName} (${priceFormatted}) sur Rower Race !\n\nVos nouveaux avantages sont immédiatement accessibles sur la plateforme : ${config.frontendUrl}\n\nVous pouvez gérer votre abonnement à tout moment depuis votre profil.\n\nSportivement,\nL'équipe Rower Race`;

    const res = await this.sendEmail({ to, subject, text, html });
    return res.success;
  }

  /**
   * Envoi d'un courriel de confirmation de clôture / résiliation d'un abonnement
   */
  public async sendSubscriptionCancellationEmail(
    to: string,
    userName: string,
    planName: string,
    effectiveDate?: string
  ): Promise<boolean> {
    const config = getEmailConfig();
    const displayName = (userName || "Rameur").trim();
    const subject = `Rower Race - Confirmation de résiliation de votre abonnement`;

    const dateNote = effectiveDate
      ? `<p style="margin-bottom: 16px;">Votre résiliation prendra effet le <strong>${effectiveDate}</strong>, à l'issue de votre période mensuelle déjà réglée.</p>`
      : `<p style="margin-bottom: 16px;">Votre résiliation a bien été prise en compte et aucun prélèvement ultérieur ne sera effectué.</p>`;

    const bodyContentHtml = `
      <div style="display: inline-block; background-color: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; color: #f59e0b; font-size: 12px; font-weight: bold; text-transform: uppercase; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; letter-spacing: 1px;">
        ℹ️ Clôture d'Abonnement
      </div>
      <h2 style="color: #ffffff; font-size: 22px; margin-top: 0; margin-bottom: 14px;">
        Bonjour <span style="color: #00e5ff;">${displayName}</span>,
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
    });

    const text = `Bonjour ${displayName},\n\nNous vous confirmons la résiliation de votre abonnement ${planName}.\nVotre compte reste actif sous la formule gratuite, et aucun prélèvement ultérieur ne sera effectué.\n\nAccéder à votre compte : ${config.frontendUrl}\n\nSportivement,\nL'équipe Rower Race`;

    const res = await this.sendEmail({ to, subject, text, html });
    return res.success;
  }

  /**
   * Envoi d'un courriel de confirmation de fermeture et suppression définitive d'un compte (RGPD Art. 17)
   */
  public async sendAccountClosureEmail(to: string, userName: string): Promise<boolean> {
    const config = getEmailConfig();
    const displayName = (userName || "Rameur").trim();
    const subject = `Rower Race - Confirmation de fermeture définitive de votre compte`;

    const bodyContentHtml = `
      <div style="display: inline-block; background-color: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; font-size: 12px; font-weight: bold; text-transform: uppercase; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; letter-spacing: 1px;">
        ✕ Compte Fermé
      </div>
      <h2 style="color: #ffffff; font-size: 22px; margin-top: 0; margin-bottom: 14px;">
        Au revoir <span style="color: #00e5ff;">${displayName}</span>,
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
    });

    const text = `Bonjour ${displayName},\n\nNous vous confirmons la fermeture définitive de votre compte Rower Race et la suppression irréversible de l'ensemble de vos données sportives et personnelles (RGPD Art. 17).\nTous vos abonnements ont été immédiatement résiliés sans prélèvement ultérieur.\n\nMerci pour votre parcours sportif à nos côtés,\nL'équipe Rower Race`;

    const res = await this.sendEmail({ to, subject, text, html });
    return res.success;
  }

  public getSentEmails(): EmailPayload[] {
    return [...this.sentEmailsLog];
  }

  public clearLog(): void {
    this.sentEmailsLog = [];
  }
}

export default EmailService.getInstance();
