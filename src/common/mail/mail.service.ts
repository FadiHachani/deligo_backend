import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {
    this.from = `"Deligo" <${this.config.get<string>('SMTP_FROM')}>`;

    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT', 587),
      secure: this.config.get<number>('SMTP_PORT', 587) === 465,
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });
  }

  async sendSupportRequest(opts: {
    fromName: string
    fromEmail: string | null
    fromPhone: string
    subject: string
    message: string
  }): Promise<void> {
    const to = this.config.get<string>('SUPPORT_EMAIL');
    const html = supportEmailHtml(opts);

    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        replyTo: opts.fromEmail ?? undefined,
        subject: `[Support] ${opts.subject}`,
        html,
      });
    } catch (err) {
      this.logger.error(`Failed to send support email: ${(err as Error).message}`);
      throw err;
    }
  }
}

function supportEmailHtml(opts: {
  fromName: string
  fromEmail: string | null
  fromPhone: string
  subject: string
  message: string
}): string {
  const name = opts.fromName || 'Unknown user';
  const email = opts.fromEmail ?? '—';
  const escapedMessage = opts.message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Support Request</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#34D186;border-radius:12px 12px 0 0;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
                Deligo Support
              </h1>
              <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.85);">
                New support request received
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:36px 40px;">

              <!-- Subject -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="border-left:4px solid #34D186;padding-left:14px;">
                    <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#98A1AB;text-transform:uppercase;letter-spacing:0.6px;">Subject</p>
                    <p style="margin:0;font-size:18px;font-weight:600;color:#1A1F24;">${escapeHtml(opts.subject)}</p>
                  </td>
                </tr>
              </table>

              <!-- Sender info -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:8px;padding:20px;margin-bottom:28px;">
                <tr>
                  <td>
                    <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#98A1AB;text-transform:uppercase;letter-spacing:0.6px;">From</p>
                    <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:#1A1F24;">${escapeHtml(name)}</p>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:24px;">
                          <p style="margin:0 0 2px;font-size:11px;color:#98A1AB;">Phone</p>
                          <p style="margin:0;font-size:14px;color:#5C6671;font-weight:500;">${escapeHtml(opts.fromPhone)}</p>
                        </td>
                        <td>
                          <p style="margin:0 0 2px;font-size:11px;color:#98A1AB;">Email</p>
                          <p style="margin:0;font-size:14px;color:#5C6671;font-weight:500;">${escapeHtml(email)}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Message -->
              <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#98A1AB;text-transform:uppercase;letter-spacing:0.6px;">Message</p>
              <div style="background:#f8f9fa;border-radius:8px;padding:20px;font-size:15px;line-height:1.7;color:#1A1F24;">
                ${escapedMessage}
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f0f2f4;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#98A1AB;">
                This email was sent from the Deligo app · Reply directly to respond to the user
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
