/**
 * Utilitaire de génération de calendriers (RFC 5545 iCalendar .ics)
 * et liens directs 1-clic pour Google Calendar et Outlook.
 */

export interface CalendarEventParams {
  eventId: string;
  title: string;
  description: string;
  url: string;
  startTime: Date | string;
  durationMinutes?: number;
  organizerName?: string;
  organizerEmail?: string;
}

/**
 * Formate un objet Date en chaîne UTC conforme au format iCalendar : YYYYMMDDTHHmmssZ
 */
export function formatIcsDate(dateInput: Date | string): string {
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) {
    throw new Error(`Date invalide fournie pour iCalendar: ${dateInput}`);
  }
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

/**
 * Échappe les caractères réservés selon la spécification RFC 5545
 */
function escapeIcsText(text: string): string {
  if (!text) return "";
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Génère un document iCalendar (.ics) standardisé RFC 5545
 */
export function generateIcsCalendar(params: CalendarEventParams): string {
  const startDate = typeof params.startTime === "string" ? new Date(params.startTime) : params.startTime;
  const durationMs = (params.durationMinutes || 30) * 60 * 1000;
  const endDate = new Date(startDate.getTime() + durationMs);

  const dtStamp = formatIcsDate(new Date());
  const dtStart = formatIcsDate(startDate);
  const dtEnd = formatIcsDate(endDate);

  const cleanUid = `race-${params.eventId.replace(/[^a-zA-Z0-9_-]/g, "")}-${Date.now()}@rowerrace.com`;
  const summary = escapeIcsText(params.title);
  const description = escapeIcsText(params.description);
  const location = escapeIcsText(params.url);

  let organizerLine = "";
  if (params.organizerEmail) {
    const orgName = params.organizerName ? `;CN=${escapeIcsText(params.organizerName)}` : "";
    organizerLine = `ORGANIZER${orgName}:mailto:${params.organizerEmail}\r\n`;
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Rower Race//Régates Connectées//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${cleanUid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `URL;VALUE=URI:${params.url}`,
    `LOCATION:${location}`,
    organizerLine ? organizerLine.trimEnd() : "",
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    `DESCRIPTION:Rappel départ régate : ${summary}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter((line) => line.length > 0)
    .join("\r\n") + "\r\n";
}

/**
 * Génère un lien direct pour ajouter l'événement dans Google Calendar
 */
export function generateGoogleCalendarUrl(params: CalendarEventParams): string {
  const startDate = typeof params.startTime === "string" ? new Date(params.startTime) : params.startTime;
  const durationMs = (params.durationMinutes || 30) * 60 * 1000;
  const endDate = new Date(startDate.getTime() + durationMs);

  const startUtc = formatIcsDate(startDate);
  const endUtc = formatIcsDate(endDate);

  const queryParams = new URLSearchParams({
    action: "TEMPLATE",
    text: params.title,
    dates: `${startUtc}/${endUtc}`,
    details: `${params.description}\n\nRejoindre la régate : ${params.url}`,
    location: params.url,
  });

  return `https://calendar.google.com/calendar/render?${queryParams.toString()}`;
}

/**
 * Génère un lien direct pour ajouter l'événement dans Outlook Web (Office 365)
 */
export function generateOutlookCalendarUrl(params: CalendarEventParams): string {
  const startDate = typeof params.startTime === "string" ? new Date(params.startTime) : params.startTime;
  const durationMs = (params.durationMinutes || 30) * 60 * 1000;
  const endDate = new Date(startDate.getTime() + durationMs);

  const queryParams = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: params.title,
    startdt: startDate.toISOString(),
    enddt: endDate.toISOString(),
    body: `${params.description}\n\nRejoindre la régate : ${params.url}`,
    location: params.url,
  });

  return `https://outlook.live.com/calendar/0/deeplink/compose?${queryParams.toString()}`;
}
