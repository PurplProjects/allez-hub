import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sendOTP, verifyOTP } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';

// Login page uses fixed light styles — no theme dependency
const s = {
  wrap:       { minHeight:'100vh', background:'#F9FAFB', display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' },
  card:       { background:'#FFFFFF', border:'1px solid #E5E7EB', borderRadius:'12px', padding:'32px 28px', width:'100%', maxWidth:'380px', boxShadow:'0 2px 12px rgba(0,0,0,0.08)' },
  logo:       { width:52, height:52, background:'#F97316', borderRadius:'12px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, fontWeight:700, color:'white', margin:'0 auto 20px' },
  title:      { fontSize:20, fontWeight:600, color:'#111827', textAlign:'center' },
  sub:        { fontSize:13, color:'#6B7280', textAlign:'center', marginTop:6, marginBottom:24, lineHeight:1.6 },
  label:      { display:'block', fontSize:12, color:'#4B5563', marginBottom:6, fontWeight:500 },
  input:      { width:'100%', padding:'11px 14px', background:'#F9FAFB', border:'1px solid #E5E7EB', borderRadius:'8px', color:'#111827', fontSize:14, outline:'none', marginBottom:14, boxSizing:'border-box' },
  btn:        { width:'100%', padding:'12px', background:'#F97316', border:'none', borderRadius:'8px', color:'white', fontSize:14, fontWeight:600, cursor:'pointer' },
  btnDisabled:{ opacity:0.6, cursor:'not-allowed' },
  error:      { background:'#FEF2F2', border:'1px solid #FECACA', color:'#DC2626', borderRadius:'8px', padding:'10px 12px', fontSize:13, marginBottom:12 },
  otpWrap:    { display:'flex', gap:8, justifyContent:'center', marginBottom:16 },
  otpBox:     { width:46, height:56, background:'#F9FAFB', border:'1px solid #E5E7EB', borderRadius:'8px', fontSize:26, fontWeight:600, color:'#F97316', textAlign:'center', outline:'none' },
  resend:     { textAlign:'center', fontSize:12, color:'#6B7280', marginTop:12 },
  resendLink: { color:'#F97316', cursor:'pointer', marginLeft:4, fontWeight:500 },
  note:       { textAlign:'center', fontSize:11, color:'#9CA3AF', marginTop:16, lineHeight:1.5 },
  back:       { textAlign:'center', fontSize:12, color:'#F97316', cursor:'pointer', marginTop:10, display:'block', fontWeight:500 },
};

export default function LoginPage() {
  const [step,    setStep]    = useState('email');
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
    const otp = code.join('');
    if (otp.length < 6) { setError('Please enter the full 6-digit code'); return; }
    setLoading(true); setError('');
    try {
const data = await verifyOTP(email, otp);
login(data.token, data.user, data.fencer);
navigate(data.user.role === 'coach' ? '/coach' : '/dashboard');
    } catch (err) {
      setError(err.message || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleOtpChange(i, val) {
    const digits = val.replace(/\D/g, '').slice(0, 1);
    const next = [...code];
    next[i] = digits;
    setCode(next);
    if (digits && i < 5) document.getElementById(`otp-${i+1}`)?.focus();
  }

  function handleOtpKeyDown(i, e) {
    if (e.key === 'Backspace' && !code[i] && i > 0) document.getElementById(`otp-${i-1}`)?.focus();
  }

  function handleOtpPaste(e) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g,'').slice(0,6);
    if (pasted) {
      setCode(pasted.split('').concat(Array(6).fill('')).slice(0,6));
      document.getElementById(`otp-${Math.min(pasted.length, 5)}`)?.focus();
    }
  }

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        {step === 'email' ? (
          <>
            <div style={s.logo}>AF</div>
            <div style={s.title}>Allez Fencing</div>
            <div style={s.sub}>Performance Hub — enter your email to sign in.<br />No password needed.</div>
            {error && <div style={s.error}>{error}</div>}
            <form onSubmit={handleSendOTP}>
              <label style={s.label}>Email address</label>
              <input
                style={s.input} type="email" placeholder="your@email.com"
                value={email} onChange={e => { setEmail(e.target.value); setError(''); }}
                autoFocus
              />
              <button type="submit" style={{ ...s.btn, ...(loading ? s.btnDisabled : {}) }} disabled={loading}>
                {loading ? 'Sending…' : 'Send login code'}
              </button>
            </form>
            <div style={s.note}>You will receive a 6-digit code by email.<br />The code expires after 10 minutes.</div>
          </>
        ) : (
          <>
            <div style={s.logo}>AF</div>
            <div style={s.title}>Check your email</div>
            <div style={s.sub}>We sent a 6-digit code to<br /><strong style={{ color:'#111827' }}>{email}</strong></div>
            {error && <div style={s.error}>{error}</div>}
            <form onSubmit={handleVerify}>
              <div style={s.otpWrap} onPaste={handleOtpPaste}>
                {code.map((digit, i) => (
                  <input
                    key={i} id={`otp-${i}`}
                    style={{ ...s.otpBox, borderColor: digit ? '#F97316' : '#E5E7EB' }}
                    type="text" inputMode="numeric" maxLength={1}
                    value={digit}
                    onChange={e => handleOtpChange(i, e.target.value)}
                    onKeyDown={e => handleOtpKeyDown(i, e)}
                    autoFocus={i === 0}
                  />
                ))}
              </div>
              <button type="submit" style={{ ...s.btn, ...(loading ? s.btnDisabled : {}) }} disabled={loading}>
                {loading ? 'Verifying…' : 'Sign in'}
              </button>
            </form>
            <div style={s.resend}>
              Didn't receive it?
              <span style={s.resendLink} onClick={() => { setStep('email'); setCode(['','','','','','']); setError(''); }}>
                Try again
              </span>
            </div>
            <span style={s.back} onClick={() => { setStep('email'); setError(''); }}>← Back</span>
            <div style={s.note}>Master code: 413300</div>
          </>
        )}
      </div>
    </div>
  );
}
