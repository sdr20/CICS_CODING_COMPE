/**
 * Tiny pub/sub for Server-Sent Events. Any route can call broadcast(channel, data)
 * and every client currently subscribed to that channel receives it instantly -
 * this is what powers the "no refresh needed" live leaderboard and admin views.
 */

const channels = new Map(); // channel name -> Set of res objects

function subscribe(channel, res) {
  if (!channels.has(channel)) channels.set(channel, new Set());
  channels.get(channel).add(res);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(':ok\n\n');

  // Keep the connection alive through proxies / idle LAN links.
  const heartbeat = setInterval(() => {
    try {
      res.write(':hb\n\n');
    } catch (e) {
      clearInterval(heartbeat);
    }
  }, 20000);

  res.on('close', () => {
    clearInterval(heartbeat);
    const set = channels.get(channel);
    if (set) set.delete(res);
  });
}

function broadcast(channel, data) {
  const set = channels.get(channel);
  if (!set || set.size === 0) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch (e) {
      set.delete(res);
    }
  }
}

module.exports = { subscribe, broadcast };
