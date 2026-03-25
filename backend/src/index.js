require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes   = require('./routes/auth');
const fencerRoutes = require('./routes/fencers');
const boutRoutes   = require('./routes/bouts');
const coachRoutes  = require('./routes/coach');
const scrapeRoutes = require('./routes/scrape');

const app  = express();
const PORT = process.env.PORT || 8080;

// ── Trust Railway's proxy ────────────────────────────────────
// Required so express-rate-limit can correctly identify client IPs
// when running behind Railway's load balancer
app.set('trust proxy', 1);

// ── Security middleware ──────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:5173',
    'https://dashboard.allezfencing.com',
    'https://allez-hub.vercel.app',
  ],
  credentials: true,
}));
app.use(express.json());

// ── Rate limiting ────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests — please try again in 15 minutes' },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
});

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth',    authLimiter,  authRoutes);
app.use('/api/fencers', apiLimiter,   fencerRoutes);
app.use('/api/bouts',   apiLimiter,   boutRoutes);
app.use('/api/coach',   apiLimiter,   coachRoutes);
app.use('/api/scrape',  apiLimiter,   scrapeRoutes);

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Error handler ────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Allez Hub API running on port ${PORT}`);
});
