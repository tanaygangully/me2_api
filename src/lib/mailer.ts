import 'dotenv/config';

// Transactional email. Uses Resend's HTTP API when RESEND_API_KEY + MAIL_FROM
// are set (plain fetch — no SDK). To use another provider, replace `send`.
//
// Without a provider:
//   - in development the message is printed to the console, so the flow can
//     be exercised locally;
//   - in production it throws, and the message (which contains a secret code)
//     is deliberately NOT logged.

async function send(to: string, subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  if (apiKey && from) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!res.ok) throw new Error(`Email provider rejected the message (${res.status}): ${await res.text()}`);
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[dev email] to=${to} subject="${subject}"\n${text}`);
    return;
  }
  throw new Error('Email is not configured: set RESEND_API_KEY and MAIL_FROM');
}

export function sendPasswordResetCode(to: string, name: string, otp: string, ttlMinutes: number) {
  return send(
    to,
    'Your ME2 password reset code',
    `Hi ${name},\n\nYour ME2 password reset code is ${otp}\n\nIt expires in ${ttlMinutes} minutes. ` +
      `If you didn't ask to reset your password, you can ignore this email — your password won't change.`
  );
}
