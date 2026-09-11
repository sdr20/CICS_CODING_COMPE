// Central configuration for the competition server.
// All values can be overridden with environment variables at start time, e.g.
//   PORT=4000 ADMIN_PASSWORD=mypassword npm start

module.exports = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  HOST: '0.0.0.0',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
  DB_PATH: require('path').join(__dirname, '..', 'database', 'competition.db')
};
