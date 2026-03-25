const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { Resend } = require('resend');
const supabase  = require('../db/supabase');

const resend = new Resend(process.env.RESEND_API_KEY);

// ── Generate 6-digit OTP ──────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ── POST /api/auth/send-otp ───────────────────────────────────
// Step 1: User enters email → we send them a code
router.post('/send-otp', async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const emailLower = email.toLowerCase().trim();

  // Check user exists in our system
  const { data: user } = await supabase
    .from('users')
    .select('id, name, role')
    .eq('email', emailLower)
    .single();

  if (!user) {
    // Don't reveal whether email exists — security best practice
    return res.json({ success: true, message: 'If that email is registered, a code has been sent.' });
  }

  // Delete any existing unused codes for this email
  await supabase.from('otp_codes').delete().eq('email', emailLower).eq('used', false);

  // Create new OTP
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await supabase.from('otp_codes').insert({
    email: emailLower,
    code,
    expires_at: expiresAt.toISOString(),
  });

  // Send email via Resend
  await resend.emails.send({
    from: process.env.FROM_EMAIL,
    to: emailLower,
    subject: 'Your Allez Fencing Hub login code',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:400px;margin:0 auto;padding:32px">
        <div style="background:#F97316;color:white;padding:12px 20px;border-radius:8px;margin-bottom:24px">
          <strong>Allez Fencing Performance Hub</strong>
        </div>
        <p style="font-size:16px;color:#333">Hi ${user.name || 'there'},</p>
        <p style="font-size:14px;color:#666">Your login code is:</p>
        <div style="font-size:40px;font-weight:bold;color:#F97316;letter-spacing:8px;padding:16px 0;text-align:center">
          ${code}
        </div>
        <p style="font-size:13px;color:#999">This code expires in 10 minutes. Do not share it with anyone.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:12px;color:#bbb">Allez Fencing Club · Brentwood School Sports Centre</p>
      </div>
    `,
  });

  res.json({ success: true, message: 'If that email is registered, a code has been sent.' });
});

// ── POST /api/auth/verify-otp ─────────────────────────────────
// Step 2: User enters 6-digit code → we return a JWT
router.post('/verify-otp', async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code || code.length !== 6) {
    return res.status(400).json({ error: 'Email and 6-digit code required' });
  }

  const emailLower = email.toLowerCase().trim();

  // Find valid, unused, non-expired OTP
  const { data: otp } = await supabase
    .from('otp_codes')
    .select('*')
    .eq('email', emailLower)
    .eq('code', code)
    .eq('used', false)
    .gte('expires_at', new Date().toISOString())
    .single();

  if (!otp) {
    return res.status(401).json({ error: 'Invalid or expired code. Please request a new one.' });
  }

  // Mark OTP as used
  await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id);

  // Get user
  const { data: user } = await supabase
    .from('users')
    .select('id, name, role, email')
    .eq('email', emailLower)
    .single();

  if (!user) return res.status(404).json({ error: 'User not found' });

  // Update last login
  await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

  // Get linked fencer (if role is fencer)
  let fencer = null;
  if (user.role !== 'coach') {
    const { data } = await supabase
      .from('fencers')
      .select('id, name, category, bf_licence, ukr_id, colour, cue_phrase')
      .eq('user_id', user.id)
      .single();
    fencer = data;
  }

  // Issue JWT
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, fencerId: fencer?.id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.json({
    success: true,
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    fencer,
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────
// Return current user from JWT
router.get('/me', require('../middleware/auth'), async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('id, name, email, role, last_login')
    .eq('id', req.user.userId)
    .single();

  res.json({ user });
});

module.exports = router;
