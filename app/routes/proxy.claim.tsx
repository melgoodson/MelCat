import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useSearchParams } from "react-router";
import { createMagicLinkToken } from "../services/auth.server";
import { sendMagicLink } from "../services/mail.server";
import { claimQrCampaign } from "../services/qr.server";
import { getCustomerSession } from "../services/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const campaign = url.searchParams.get("c"); // QR campaign hash
  const session = await getCustomerSession(request);
  const customerId = session.get("customerId");

  return { campaign, isLoggedIn: !!customerId };
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const campaignHash = formData.get("campaign") as string;

  if (!email || !email.includes("@")) {
    return { error: "Please enter a valid email address." };
  }

  try {
    const token = await createMagicLinkToken(email);

    // Build callback URL with campaign context
    const url = new URL(request.url);
    let callbackUrl = `${url.origin}/apps/snarky/proxy/auth/callback?token=${token}`;
    if (campaignHash) {
      callbackUrl += `&c=${encodeURIComponent(campaignHash)}`;
    }

    await sendMagicLink(email, token, callbackUrl);

    return {
      success: true,
      message: "Check your email! We sent you a magic link to access your digital content.",
    };
  } catch (err) {
    console.error("[Claim] Error:", err);
    return { error: "Something went wrong. Please try again." };
  }
}

export default function ClaimPortal() {
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const campaign = searchParams.get("c") || "";

  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>
        <div style={styles.header}>
            <div style={{ margin: '0 auto 1.5rem', width: '100px', height: '100px', borderRadius: '50%', overflow: 'hidden', border: '3px solid #f28c28' }}>
              <img src="/apps/snarky/proxy/mascot.jpeg" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          <h1 style={styles.title}>MelCat</h1>
          <p style={styles.subtitle}>Unlock Your Digital Treasures</p>
        </div>

        {actionData?.success ? (
          <div style={styles.successCard}>
            <div style={styles.successIcon}>✉️</div>
            <h2 style={styles.successTitle}>Check Your Email!</h2>
            <p style={styles.successText}>{actionData.message}</p>
          </div>
        ) : (
          <div style={styles.formCard}>
            {campaign && (
              <div style={styles.campaignBadge}>
                🎉 QR Campaign: <strong>{campaign}</strong>
              </div>
            )}
            <p style={styles.formText}>
              Enter your email to receive a secure magic link. No password
              needed!
            </p>

            {actionData?.error && (
              <div style={styles.errorBanner}>{actionData.error}</div>
            )}

            <Form method="post">
              <input type="hidden" name="campaign" value={campaign} />
              <div style={styles.inputGroup}>
                <input
                  type="email"
                  name="email"
                  placeholder="you@example.com"
                  required
                  style={styles.input}
                />
                <button type="submit" style={styles.button}>
                  Send Magic Link
                </button>
              </div>
            </Form>
          </div>
        )}

        <p style={styles.footer}>
          Your email is only used to deliver your digital content.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: "100vh",
    background: "#fffaf0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem",
    fontFamily: "'Outfit', 'Segoe UI', system-ui, sans-serif",
  },
  container: {
    maxWidth: "480px",
    width: "100%",
    textAlign: "center" as const,
  },
  header: {
    marginBottom: "2rem",
  },
  title: {
    fontSize: "3rem",
    fontWeight: 800,
    background: "linear-gradient(90deg, #f28c28, #e37322)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    margin: "0 0 0.25rem 0",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    fontSize: "1.2rem",
    color: "#6b5c4f",
    margin: 0,
  },
  formCard: {
    background: "#fff",
    borderRadius: "24px",
    padding: "3rem 2rem",
    boxShadow: "0 20px 40px rgba(45, 27, 13, 0.08)",
    border: "1px solid rgba(242, 140, 40, 0.1)",
  },
  campaignBadge: {
    background: "rgba(242, 140, 40, 0.1)",
    color: "#e37322",
    padding: "0.6rem 1.2rem",
    borderRadius: "30px",
    fontSize: "0.85rem",
    fontWeight: 700,
    marginBottom: "1.5rem",
    display: "inline-block",
  },
  formText: {
    color: "#2d1b0d",
    fontSize: "1rem",
    marginBottom: "2rem",
    lineHeight: 1.6,
  },
  errorBanner: {
    background: "#fff1f0",
    border: "1px solid #ffa39e",
    color: "#cf1322",
    padding: "0.75rem 1rem",
    borderRadius: "10px",
    fontSize: "0.85rem",
    marginBottom: "1.5rem",
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "1rem",
  },
  input: {
    width: "100%",
    padding: "1rem 1.2rem",
    borderRadius: "14px",
    border: "1px solid #d9d9d9",
    background: "#fff",
    color: "#2d1b0d",
    fontSize: "1rem",
    outline: "none",
    boxSizing: "border-box" as const,
    transition: "border-color 0.2s",
  },
  button: {
    width: "100%",
    padding: "1rem",
    borderRadius: "14px",
    border: "none",
    background: "linear-gradient(135deg, #f28c28, #e37322)",
    color: "#fff",
    fontSize: "1.1rem",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 8px 15px rgba(242, 140, 40, 0.3)",
    transition: "transform 0.15s",
  },
  successCard: {
    background: "#fff",
    borderRadius: "24px",
    padding: "3rem 2rem",
    boxShadow: "0 20px 40px rgba(45, 27, 13, 0.08)",
  },
  successIcon: {
    fontSize: "4rem",
    marginBottom: "1rem",
  },
  successTitle: {
    fontSize: "1.75rem",
    fontWeight: 800,
    color: "#2d1b0d",
    margin: "0 0 1rem 0",
  },
  successText: {
    color: "#6b5c4f",
    fontSize: "1rem",
    lineHeight: 1.6,
    margin: 0,
  },
  footer: {
    color: "#6b5c4f",
    fontSize: "0.8rem",
    marginTop: "2rem",
    opacity: 0.7,
  },
};
