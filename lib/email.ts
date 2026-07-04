import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { createTransport } from 'nodemailer';

let ses: SESClient | null = null;
function client() {
  if (!ses) ses = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
  return ses;
}

const isLocal = process.env.LOCAL_DDB === 'true';
const FROM = process.env.SES_FROM_EMAIL || process.env.ADMIN_EMAIL || 'noreply@localhost';
const SMTP_HOST = process.env.SMTP_HOST || 'localhost';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '1025', 10);

async function send(to: string, subject: string, body: string): Promise<boolean> {
  if (isLocal) {
    // Send via Mailpit SMTP — viewable at http://localhost:8025
    try {
      const transport = createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: false });
      await transport.sendMail({ from: FROM, to, subject, text: body });
      console.log(`📧 [email:dev] Sent to ${to} → view at http://localhost:8025`);
    } catch (e) {
      // Fallback to console if Mailpit isn't running — still a successful "send"
      // from the caller's perspective (dev-only path, nothing to retry).
      console.log('\n📧 [email:dev] ─────────────────────────────');
      console.log(`  To:      ${to}`);
      console.log(`  Subject: ${subject}`);
      console.log(`  Body:\n${body.split('\n').map((l) => `    ${l}`).join('\n')}`);
      console.log('────────────────────────────────────────────\n');
      console.log('  (Mailpit not running — install with: docker compose up -d mailpit)');
    }
    return true;
  }
  if (!FROM) { console.warn('[email] SES_FROM_EMAIL not set, skipping send'); return false; }
  try {
    await client().send(new SendEmailCommand({
      Source: FROM,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject },
        Body: { Text: { Data: body } },
      },
    }));
    return true;
  } catch (e) {
    console.error('[email] SES send failed:', (e as Error).message);
    return false;
  }
}

export async function notifyAdminTokenRequest(opts: {
  adminEmail: string;
  requesterEmail: string;
  requesterName: string;
  provider: string;
  limit: number;
  reason?: string;
}) {
  await send(
    opts.adminEmail,
    `Token request from ${opts.requesterName}`,
    `${opts.requesterName} (${opts.requesterEmail}) has requested a token.\n\nProvider: ${opts.provider}\nLimit: ${opts.limit}${opts.reason ? `\nReason: ${opts.reason}` : ''}\n\nLog in to the admin panel to approve or deny.`,
  );
}

export async function notifyRequesterApproved(opts: {
  requesterEmail: string;
  requesterName: string;
  appUrl: string;
  token: string;
}) {
  await send(
    opts.requesterEmail,
    'Your token request has been approved',
    `Hi ${opts.requesterName},\n\nYour access request has been approved. Use the link below to start chatting:\n\n${opts.appUrl}?token=${opts.token}\n\nKeep this URL private — it is your personal access link.`,
  );
}

export async function notifyRequesterDenied(opts: {
  requesterEmail: string;
  requesterName: string;
}) {
  await send(
    opts.requesterEmail,
    'Your token request was not approved',
    `Hi ${opts.requesterName},\n\nWe were unable to approve your access request at this time. Please contact the administrator for more information.`,
  );
}

export async function notifyAdminContact(opts: { adminEmail: string; fromLabel: string; message: string }): Promise<boolean> {
  return send(opts.adminEmail, 'Contact form message', `${opts.message}\n\n—\nFrom: ${opts.fromLabel}`);
}
