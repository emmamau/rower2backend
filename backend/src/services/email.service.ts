/**
 * Service de gestion des courriels pour la plateforme Rower Race.
 * Prévu pour les notifications d'inscription, confirmations et réinitialisations de mot de passe.
 */
export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
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
   * Envoi d'un courriel via Resend (API / SMTP) avec fallback mock/test
   */
  public async sendEmail(payload: EmailPayload): Promise<{ success: boolean; messageId: string }> {
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.sentEmailsLog.push(payload);

    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.EMAIL_FROM || "Rower Race <onboarding@resend.dev>";

    if (resendApiKey && process.env.NODE_ENV !== "test") {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: fromEmail,
            to: payload.to,
            subject: payload.subject,
            text: payload.text,
            html: payload.html || payload.text.replace(/\n/g, "<br>"),
          }),
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
    } else if (process.env.NODE_ENV !== "test") {
      console.log(`[EmailService] Simulation/SMTP Resend vers: ${payload.to} | Sujet: ${payload.subject}`);
    }

    return { success: true, messageId };
  }

  /**
   * Envoi d'un courriel de bienvenue lors de la création d'un compte abonné
   */
  public async sendWelcomeEmail(to: string, userName: string, login: string): Promise<boolean> {
    const subject = "Bienvenue sur Rower Race - Votre compte abonné est créé";
    const text = `Bonjour ${userName},\n\nVotre compte abonné a bien été créé avec le login : ${login}.\nCe login unique vous permet de confirmer votre montre Garmin et de créer des salons de course privés.\n\nSportivement,\nL'équipe Rower Race`;
    const res = await this.sendEmail({ to, subject, text });
    return res.success;
  }

  /**
   * Envoi d'un courriel de confirmation d'inscription via l'application Garmin
   */
  public async sendRegistrationConfirmationEmail(to: string, login: string): Promise<boolean> {
    const subject = "Rower Race - Inscription confirmée par votre montre Garmin";
    const text = `Félicitations !\n\nVotre inscription avec le login ${login} a bien été validée depuis votre montre Garmin Connect IQ.\nVous pouvez dès maintenant organiser vos régates privées.\n\nL'équipe Rower Race`;
    const res = await this.sendEmail({ to, subject, text });
    return res.success;
  }

  /**
   * Envoi d'un courriel de réinitialisation de mot de passe
   */
  public async sendPasswordResetEmail(to: string, login: string, resetToken: string): Promise<boolean> {
    const subject = "Rower Race - Réinitialisation de votre mot de passe";
    const resetUrl = `https://rower-race.com/reset-password?token=${encodeURIComponent(resetToken)}`;
    const text = `Bonjour,\n\nVous avez demandé la réinitialisation du mot de passe pour le compte ${login}.\nPour définir un nouveau mot de passe, veuillez utiliser le lien suivant (valable 1 heure) :\n${resetUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer ce message.\n\nL'équipe Rower Race`;
    const res = await this.sendEmail({ to, subject, text });
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
