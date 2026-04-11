/**
 * Deligo WebSocket stress test — k6
 *
 * Simulates N approved drivers connected to /tracking and sending
 * location_update events at a realistic cadence (every 2s).
 * Also simulates client observers joining the same booking rooms.
 *
 * Prerequisite: run seed.ts first, then manually create a booking (or use
 *   the full_flow scenario in http-load.js) and paste its ID below, OR
 *   let this script self-provision by first creating a request + bid + accept
 *   via HTTP (see setupBooking()).
 *
 * Run:
 *   k6 run stress-test/ws-load.js
 *   k6 run --vus 20 --duration 60s stress-test/ws-load.js
 */

import ws from 'k6/ws';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE_HTTP = 'http://localhost:3000';
const BASE_WS   = 'ws://localhost:3000/tracking';

const clientTokens = new SharedArray('clients', function () {
  return JSON.parse(open('./tokens.json')).clientTokens;
});

const driverTokens = new SharedArray('drivers', function () {
  return JSON.parse(open('./tokens.json')).driverTokens;
});

// ── Custom metrics ────────────────────────────────────────────────────────────
const locationsSent   = new Counter('ws_location_updates_sent');
const locationsRecv   = new Counter('ws_location_broadcasts_received');
const wsErrors        = new Rate('ws_errors');

// ── Options ───────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // Driver location stream — each VU is one driver
    driver_location_stream: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 5  },  // ramp up to 5 drivers
        { duration: '60s', target: 10 },  // ramp to 10
        { duration: '20s', target: 0  },  // ramp down
      ],
      exec: 'scenarioDriverStream',
      tags: { scenario: 'driver_ws' },
    },

    // Client observers — each VU connects and listens to all broadcasts
    client_observers: {
      executor: 'constant-vus',
      vus: 5,
      duration: '2m',
      exec: 'scenarioClientObserver',
      tags: { scenario: 'client_ws' },
    },
  },

  thresholds: {
    ws_errors: ['rate<0.05'],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function randomClient() {
  return clientTokens[Math.floor(Math.random() * clientTokens.length)];
}

function randomDriver() {
  return driverTokens[Math.floor(Math.random() * driverTokens.length)];
}

function randomCoord() {
  return {
    lat: parseFloat((36.7 + Math.random() * 0.3).toFixed(6)),
    lng: parseFloat((10.1 + Math.random() * 0.3).toFixed(6)),
  };
}

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/**
 * Provisions a booking for a given client/driver pair via HTTP.
 * Returns bookingId or null on failure.
 */
function setupBooking(clientToken, driverToken) {
  const cH = authHeaders(clientToken);
  const dH = authHeaders(driverToken);
  const coord = randomCoord();

  // Create request
  const createRes = http.post(`${BASE_HTTP}/api/requests`, JSON.stringify({
    pickup_lat: coord.lat,
    pickup_lng: coord.lng,
    dropoff_lat: coord.lat + 0.05,
    dropoff_lng: coord.lng + 0.05,
    item_category: 'Furniture',
    description: 'WebSocket stress test load item for benchmark',
  }), { headers: cH });

  if (createRes.status < 200 || createRes.status >= 300) return null;
  const requestId = JSON.parse(createRes.body)?.data?.id;
  if (!requestId) return null;

  // Driver bids
  const bidRes = http.post(`${BASE_HTTP}/api/bids`, JSON.stringify({
    request_id: requestId,
    amount: 40,
    note: 'ws test bid',
  }), { headers: dH });
  if (bidRes.status < 200 || bidRes.status >= 300) return null;
  const bidId = JSON.parse(bidRes.body)?.data?.id;
  if (!bidId) return null;

  // Client accepts
  const acceptRes = http.post(`${BASE_HTTP}/api/bids/${bidId}/accept`, null, { headers: cH });
  if (acceptRes.status < 200 || acceptRes.status >= 300) return null;

  // Get booking id
  const bookingsRes = http.get(`${BASE_HTTP}/api/bookings`, { headers: dH });
  const bookings = JSON.parse(bookingsRes.body)?.data ?? [];
  const booking = bookings.find((b) => b.request_id === requestId);
  if (!booking) return null;

  // Start it (moves to in_transit so location_update is accepted)
  http.patch(`${BASE_HTTP}/api/bookings/${booking.id}/start`, null, { headers: dH });

  return booking.id;
}

// ── Scenario A: Driver streams location updates ───────────────────────────────
export function scenarioDriverStream() {
  const driver = randomDriver();
  const client = randomClient();

  // Provision a booking first
  const bookingId = setupBooking(client.accessToken, driver.accessToken);
  if (!bookingId) {
    console.warn('Could not provision booking, skipping VU');
    return;
  }

  const url = `${BASE_WS}?token=${driver.accessToken}`;
  const params = { headers: {} };

  const res = ws.connect(url, params, function (socket) {
    socket.on('open', function () {
      // Join the booking room
      socket.send(JSON.stringify({ event: 'join_booking', data: { bookingId } }));

      // Send location every 2 seconds
      const interval = socket.setInterval(function () {
        const coord = randomCoord();
        socket.send(JSON.stringify({
          event: 'location_update',
          data: {
            bookingId,
            lat: coord.lat,
            lng: coord.lng,
            heading: Math.floor(Math.random() * 360),
          },
        }));
        locationsSent.add(1);
      }, 2000);

      // Run for 30 seconds then disconnect
      socket.setTimeout(function () {
        socket.clearInterval(interval);
        socket.send(JSON.stringify({ event: 'leave_booking', data: { bookingId } }));
        socket.close();
      }, 30000);
    });

    socket.on('message', function (raw) {
      try {
        const msg = JSON.parse(raw);
        if (msg.event === 'location_broadcast') {
          locationsRecv.add(1);
        }
      } catch (_) {}
    });

    socket.on('error', function (e) {
      wsErrors.add(1);
      console.error('WS error:', e);
    });
  });

  check(res, { 'ws connected successfully': (r) => r && r.status === 101 });
}

// ── Scenario B: Client observers (listen-only) ────────────────────────────────
export function scenarioClientObserver() {
  const client = randomClient();
  const driver = randomDriver();

  // Get or create a booking to observe
  const bookingId = setupBooking(client.accessToken, driver.accessToken);
  if (!bookingId) {
    sleep(5);
    return;
  }

  const url = `${BASE_WS}?token=${client.accessToken}`;

  ws.connect(url, {}, function (socket) {
    socket.on('open', function () {
      socket.send(JSON.stringify({ event: 'join_booking', data: { bookingId } }));

      socket.setTimeout(function () {
        socket.close();
      }, 25000);
    });

    socket.on('message', function (raw) {
      try {
        const msg = JSON.parse(raw);
        if (msg.event === 'location_broadcast') {
          locationsRecv.add(1);
        }
      } catch (_) {}
    });

    socket.on('error', function () { wsErrors.add(1); });
  });
}
