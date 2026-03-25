import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sendOTP, verifyOTP } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { theme } from '../../lib/theme';

const s = {
  wrap:    { minHeight:'100vh', background:theme.black, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' },
  card:    { background:theme.surface1, border:`0.5px solid ${theme.surface3}`, borderRadius:theme.borderRadius, padding:'32px 28px', width:'100%', maxWidth:'380px' },
  logo:    { width:52, height:52, background:theme.primary, borderRadius:'12px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, fontWeight:500, color:'white', margin:'0 auto 20px' },
  title:   { fontSize:20, fontWeight:500, color:theme.textPrimary, textAlign:'center' },
  sub:     { fontSize:13, color:theme.textTertiary, textAlign:'center', marginTop:6, marginBottom:24, lineHeight:1.6 },
  label:   { display:'block', fontSize:12, color:theme.textSecondary, marginBottom:6 },
  input:   { width:'100%', padding:'11px 14px', background:theme.surface2, border:`0.5px solid ${theme.surface3}`, borderRadius:theme.borderRadiusSm, color:theme.textPrimary, fontSize:14, outline:'none', marginBottom:14, boxSizing:'border-box' },
  btn:     { width:'100%', padding:'12px', background:theme.primary, border:'none', borderRadius:theme.borderRadiusSm, color:'white', fontSize:14, fontWeight:500, cursor:'pointer' },
  btnDisabled: { opacity:0.6, cursor:'not-allowed' },
  error:   { background:'#450a0a', color:'#fca5a5', borderRadius:theme.borderRadiusSm, padding:'10px 12px', fontSize:13, marginBottom:12 },
  otpWrap: { display:'flex', gap:8, justifyContent:'center', marginBottom:16 },
  otpBox:  { width:46, height:56, background:theme.surface2, border:`0.5px solid ${theme.surface3}`, borderRadius:theme.borderRadiusSm, fontSize:26, fontWeight:500, color:theme.primary, textAlign:'center', outline:'none' },
  resend:  { textAlign:'center', fontSize:12, color:theme.textTertiary, marginTop:12 },
  resendLink: { color:theme.primary, cursor:'pointer', marginLeft:4 },
  note:    { textAlign:'center', fontSize:11, color:theme.textTertiary, marginTop:16, lineHeight:1.5 },
  back:    { textAlign:'center', fontSize:12, color:theme.primary, cursor:'pointer', marginTop:10, display:'block' },
};

export default function LoginPage() {
  const [step,    setStep]    = useState('email');  // 'email' | 'otp'
  const [email,   setEmail]   = useState('');
  const [code,    setCode]    = useState(['','','','','','']);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const { login } = useAuth();
  const navigate  = useNavigate();

  async function handleSendOTP(e) {
    e.preventDefault();
    if (!email.includes('@')) { setError('Please enter a valid email address'); return; }
    setLoading(true); setError('');
    try {
      await sendOTP(email);
      setStep('otp');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e) {
    e.preventDefault();
    const fullCode = code.join('');
    if (fullCode.length < 6) { setError('Please enter all 6 digits'); return; }
    setLoading(true); setError('');
    try {
      const data = await verifyOTP(email, fullCode);
      login(data.token, data.user, data.fencer);
      navigate(data.user.role === 'coach' ? '/coach' : '/dashboard');
    } catch (err) {
      setError(err.message || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleCodeInput(val, idx) {
    const newCode = [...code];
    newCode[idx] = val.slice(-1);
    setCode(newCode);
    // Auto-advance to next box
    if (val && idx < 5) {
      document.getElementById(`otp-${idx + 1}`)?.focus();
    }
  }

  function handleCodeKeyDown(e, idx) {
    if (e.key === 'Backspace' && !code[idx] && idx > 0) {
      document.getElementById(`otp-${idx - 1}`)?.focus();
    }
  }

  // Handle paste — fill all 6 boxes at once
  function handlePaste(e) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setCode(pasted.split(''));
      document.getElementById('otp-5')?.focus();
    }
  }

  return (
    <div style={s.wrap}>
      {step === 'email' ? (
        <div style={s.card}>
          <div style={s.logo}>{theme.clubShort}</div>
          <div style={s.title}>{theme.clubName}</div>
          <div style={s.sub}>Performance Hub — enter your email to sign in.<br />No password needed.</div>
          {error && <div style={s.error}>{error}</div>}
          <form onSubmit={handleSendOTP}>
            <label style={s.label}>Email address</label>
            <input
              style={s.input}
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoFocus
            />
            <button style={{ ...s.btn, ...(loading ? s.btnDisabled : {}) }} disabled={loading}>
              {loading ? 'Sending…' : 'Send login code'}
            </button>
          </form>
          <div style={s.note}>You will receive a 6-digit code by email.<br />The code expires after 10 minutes.</div>
        </div>
      ) : (
        <div style={s.card}>
          <div style={s.logo}>{theme.clubShort}</div>
          <div style={s.title}>Check your email</div>
          <div style={s.sub}>We sent a 6-digit code to<br /><strong style={{ color:theme.textPrimary }}>{email}</strong></div>
          {error && <div style={s.error}>{error}</div>}
          <form onSubmit={handleVerify}>
            <div style={s.otpWrap} onPaste={handlePaste}>
              {code.map((digit, i) => (
                <input
                  key={i}
                  id={`otp-${i}`}
                  style={{ ...s.otpBox, borderColor: digit ? theme.primary : theme.surface3 }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleCodeInput(e.target.value, i)}
                  onKeyDown={e => handleCodeKeyDown(e, i)}
                  autoFocus={i === 0}
                />
              ))}
            </div>
            <button style={{ ...s.btn, ...(loading ? s.btnDisabled : {}) }} disabled={loading}>
              {loading ? 'Verifying…' : 'Sign in'}
            </button>
          </form>
          <div style={s.resend}>
            Didn't get it?
            <span style={s.resendLink} onClick={() => { sendOTP(email); setError(''); }}>Resend code</span>
          </div>
          <span style={s.back} onClick={() => { setStep('email'); setError(''); setCode(['','','','','','']); }}>
            ← Change email
          </span>
        </div>
      )}
    </div>
  );
}
