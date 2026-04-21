import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "MelCat <noreply@melcat.app>";

export async function sendMagicLink(email: string, token: string, callbackUrl: string) {
  if (!process.env.RESEND_API_KEY) {
    // Fallback: log to console in dev if no key is set
    console.log(`\n----------------------------`);
    console.log(`[MAIL] Magic link for ${email}:`);
    console.log(`[MAIL] ${callbackUrl}`);
    console.log(`----------------------------\n`);
    return true;
  }

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Your MelCat Magic Link 🐾",
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>MelCat — Magic Link</title>
      </head>
      <body style="margin:0;padding:0;background:#fffaf0;font-family:'Segoe UI',sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffaf0;padding:40px 20px;">
          <tr>
            <td align="center">
              <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(45,27,13,0.1);border:1px solid rgba(242,140,40,0.15);">
                <!-- Header -->
                <tr>
                  <td style="background:linear-gradient(135deg,#2d1b0d,#4a2e12);padding:40px 40px 32px;text-align:center;">
                    <p style="margin:0 0 16px;font-size:48px;">🐾</p>
                    <h1 style="margin:0;font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.02em;">MelCat Vault</h1>
                    <p style="margin:8px 0 0;color:rgba(255,255,255,0.6);font-size:14px;">Your digital content awaits</p>
                  </td>
                </tr>
                <!-- Body -->
                <tr>
                  <td style="padding:40px;">
                    <p style="margin:0 0 8px;font-size:16px;color:#2d1b0d;font-weight:600;">Hey there! 👋</p>
                    <p style="margin:0 0 32px;font-size:15px;color:#6b5c4f;line-height:1.6;">
                      Big Mel sent you this secure magic link to access your digital content library. Just click the button below — no password needed.
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center">
                          <a href="${callbackUrl}"
                             style="display:inline-block;background:linear-gradient(135deg,#f28c28,#e37322);color:#fff;text-decoration:none;padding:16px 40px;border-radius:14px;font-size:16px;font-weight:700;letter-spacing:-0.01em;box-shadow:0 8px 20px rgba(242,140,40,0.35);">
                            Enter the MelCat Vault →
                          </a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:32px 0 0;font-size:13px;color:#9ca3af;text-align:center;line-height:1.6;">
                      This link expires in <strong>15 minutes</strong> and can only be used once.<br/>
                      If you didn't request this, you can safely ignore this email.
                    </p>
                  </td>
                </tr>
                <!-- Footer -->
                <tr>
                  <td style="background:#fdf8f4;padding:20px 40px;border-top:1px solid rgba(242,140,40,0.1);text-align:center;">
                    <p style="margin:0;font-size:12px;color:#9ca3af;">
                      MelCat Digital Vault · Powered by Big Mel ™
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  });

  if (error) {
    console.error("[Mail] Resend error:", error);
    throw new Error(`Failed to send magic link: ${error.message}`);
  }

  console.log(`[Mail] Magic link sent to ${email} (id: ${data?.id})`);
  return true;
}
