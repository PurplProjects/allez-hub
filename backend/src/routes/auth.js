const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { Resend } = require('resend');
const supabase  = require('../db/supabase');

// Lazy initialisation — Resend only created when needed so a missing
// key does NOT crash the server on startup
let _resend = null;
function getResend() {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key || key === 'placeholder_get_real_key_soon') {
      throw new Error('RESEND_API_KEY not configured');
    }
    _resend = new Resend(key);
  }
  return _resend;
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  const emailLower = email.toLowerCase().trim();

  const { data: user } = await supabase
    .from('users').select('id, name, role').eq('email', emailLower).single();

  if (!user) {
    return res.json({ success: true, message: 'If that email is registered, a code has been sent.' });
  }

  await supabase.from('otp_codes').delete().eq('email', emailLower).eq('used', false);

  const code      = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await supabase.from('otp_codes').insert({
    email: emailLower, code, expires_at: expiresAt.toISOString(),
  });

  // Try to send email — if Resend not configured yet, log OTP to Railway logs
  try {
    const resend = getResend();
    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'noreply@allezfencing.com',
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
  } catch (emailErr) {
    // RESEND NOT CONFIGURED — print OTP to Railway logs so you can still test
    // Remove this console.log once RESEND_API_KEY is added to Railway variables
    console.log(`\n========================================`);
    console.log(`OTP for ${emailLower}: ${code}`);
    console.log(`(Add RESEND_API_KEY to Railway to send real emails)`);
    console.log(`========================================\n`);
  }

  res.json({ success: true, message: 'If that email is registered, a code has been sent.' });
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code || code.length !== 6) {
    return res.status(400).json({ error: 'Email and 6-digit code required' });
  }
  const emailLower = email.toLowerCase().trim();

  const { data: otp } = await supabase
    .from('otp_codes').select('*')
    .eq('email', emailLower).eq('code', code).eq('used', false)
    .gte('expires_at', new Date().toISOString()).single();

  if (!otp) {
    return res.status(401).json({ error: 'Invalid or expired code. Please request a new one.' });
  }

  await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id);

  const { data: user } = await supabase
    .from('users').select('id, name, role, email').eq('email', emailLower).single();

  if (!user) return res.status(404).json({ error: 'User not found' });

  await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

  let fencer = null;
  if (user.role !== 'coach') {
    const { data } = await supabase
      .from('fencers')
      .select('id, name, category, bf_licence, ukr_id, colour, cue_phrase')
      .eq('user_id', user.id).single();
    fencer = data;
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, fencerId: fencer?.id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role }, fencer });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth'), async (req, res) => {
  const { data: user } = await supabase
    .from('users').select('id, name, email, role, last_login').eq('id', req.user.userId).single();
  res.json({ user });
});

module.exports = router;
