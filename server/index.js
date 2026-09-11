const express = require('express');
const path = require('path');
const os = require('os');
require('./database'); // creates schema + seeds sample data on first run

const { PORT, HOST } = require('./config');

const playersRoutes = require('./routes/players');
const levelsRoutes = require('./routes/levels');
const leaderboardRoutes = require('./routes/leaderboard');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', playersRoutes);
app.use('/api', levelsRoutes);
app.use('/api', leaderboardRoutes);
app.use('/api', adminRoutes);

// Explicit page routes (also reachable directly via the static files above).
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.get('/player', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'player.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
app.get('/ranking', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'ranking.html')));

// Fallback 404 for unknown API routes.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

function localIPv4Addresses() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) results.push(net.address);
    }
  }
  return results;
}

app.listen(PORT, HOST, () => {
  console.log('==============================================');
  console.log('  CCS CODE CHALLENGE - Competition Server');
  console.log('==============================================');
  console.log(`  Local:    http://localhost:${PORT}`);
  localIPv4Addresses().forEach((ip) => {
    console.log(`  Network:  http://${ip}:${PORT}   <-- share this with players`);
  });
  console.log(`  Admin:    http://localhost:${PORT}/admin`);
  console.log('==============================================');
});
