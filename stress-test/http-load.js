/**
 * Deligo HTTP stress test — k6
 *
 * Scenarios:
 *   A) auth       — token refresh (exercises JWT + DB)
 *   B) client     — create transport request, list, cancel
 *   C) driver     — list open requests, place bid, withdraw bid
 *   D) bid_accept — client accepts a driver's bid (creates booking)
 *   E) booking    — driver works a booking: start → deliver
 *
 * Prerequisites:
 *   1. Run `npx ts-node stress-test/seed.ts` first
 *   2. Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
 *      Ubuntu/Debian: sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69 && echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list && sudo apt-get update && sudo apt-get install k6
 *
 * Run:
 *   k6 run stress-test/http-load.js
 *   k6 run --vus 50 --duration 60s stress-test/http-load.js     # quick smoke
 *   k6 run stress-test/http-load.js --out json=results.json      # export metrics
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// ── Load seeded tokens ────────────────────────────────────────────────────────
const clientTokens = new SharedArray('clients', function () {
  return JSON.parse(open('./tokens.json')).clientTokens;
});

const driverTokens = new SharedArray('drivers', function () {
  return JSON.parse(open('./tokens.json')).driverTokens;
});

// ── Config ────────────────────────────────────────────────────────────────────
const BASE = 'http://localhost:3000';

const HEADERS = (token) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
});

// ── Custom metrics ────────────────────────────────────────────────────────────
const requestCreated   = new Counter('requests_created');
const bidsPlaced       = new Counter('bids_placed');
const bidsAccepted     = new Counter('bids_accepted');
const bookingsStarted  = new Counter('bookings_started');
const bookingsDelivered = new Counter('bookings_delivered');
const errorRate        = new Rate('errors');
const requestDuration  = new Trend('request_duration', true);

// ── Scenarios ─────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // Scenario A: constant token refresh (auth stress)
    auth_refresh: {
      executor: 'constant-arrival-rate',
      rate: 20,          // 20 req/s
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 10,
      maxVUs: 30,
      exec: 'scenarioAuth',
      tags: { scenario: 'auth' },
    },

    // Scenario B: clients creating transport requests
    client_requests: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m',  target: 20 },
        { duration: '30s', target: 0  },
      ],
      exec: 'scenarioClientRequest',
      tags: { scenario: 'client' },
    },

    // Scenario C: drivers browsing & bidding
    driver_bids: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 5  },
        { duration: '1m',  target: 10 },
        { duration: '30s', target: 0  },
      ],
      exec: 'scenarioDriverBid',
      tags: { scenario: 'driver' },
    },

    // Scenario D: full request → bid → accept → booking flow
    full_flow: {
      executor: 'per-vu-iterations',
      vus: 5,
      iterations: 10,
      maxDuration: '3m',
      exec: 'scenarioFullFlow',
      tags: { scenario: 'full_flow' },
      startTime: '30s', // wait for some requests to exist
    },
  },

  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    errors:            ['rate<0.05'],
    http_req_failed:   ['rate<0.05'],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function randomClient() {
  return clientTokens[Math.floor(Math.random() * clientTokens.length)];
}

function randomDriver() {
  return driverTokens[Math.floor(Math.random() * driverTokens.length)];
}

function ok(res, label) {
  const passed = check(res, {
    [`${label} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
  });
  errorRate.add(!passed);
  requestDuration.add(res.timings.duration);
  return passed;
}

// Tunisia bounding box — random coords inside Tunis area
function randomCoord() {
  const lat = 36.7 + Math.random() * 0.3;
  const lng = 10.1 + Math.random() * 0.3;
  return { lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) };
}

const CATEGORIES = ['Furniture', 'Appliances', 'Electronics', 'Construction', 'Packages'];

function randomRequest() {
  const pickup = randomCoord();
  const dropoff = randomCoord();
  return {
    pickup_lat: pickup.lat,
    pickup_lng: pickup.lng,
    dropoff_lat: dropoff.lat,
    dropoff_lng: dropoff.lng,
    item_category: CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)],
    description: 'Stress test load item for k6 benchmark run',
  };
}

// ── Scenario A: Auth (token refresh) ─────────────────────────────────────────
export function scenarioAuth() {
  const user = randomClient();
  const res = http.post(
    `${BASE}/api/auth/refresh`,
    JSON.stringify({ refreshToken: user.refreshToken }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  ok(res, 'refresh');
  sleep(0.1);
}

// ── Scenario B: Client creates requests ───────────────────────────────────────
export function scenarioClientRequest() {
  const client = randomClient();
  const h = HEADERS(client.accessToken);

  // Create request
  const create = http.post(
    `${BASE}/api/requests`,
    JSON.stringify(randomRequest()),
    { headers: h },
  );
  if (!ok(create, 'create_request')) { sleep(1); return; }
  requestCreated.add(1);

  const body = JSON.parse(create.body);
  const requestId = body?.data?.id;
  if (!requestId) { sleep(1); return; }

  // Fetch it
  http.get(`${BASE}/api/requests/${requestId}`, { headers: h });

  // Cancel it (don't pile up open requests)
  http.patch(`${BASE}/api/requests/${requestId}/cancel`, null, { headers: h });

  sleep(Math.random() * 2 + 1);
}

// ── Scenario C: Driver lists requests and bids ────────────────────────────────
export function scenarioDriverBid() {
  const driver = randomDriver();
  const h = HEADERS(driver.accessToken);

  // List open requests
  const list = http.get(`${BASE}/api/requests?status=OPEN`, { headers: h });
  ok(list, 'list_requests');

  const body = JSON.parse(list.body);
  const requests = body?.data ?? [];
  if (requests.length === 0) { sleep(2); return; }

  const req = requests[Math.floor(Math.random() * requests.length)];

  // Place a bid
  const bid = http.post(
    `${BASE}/api/bids`,
    JSON.stringify({
      request_id: req.id,
      amount: Math.floor(Math.random() * 80) + 20,
      note: 'k6 load test bid',
    }),
    { headers: h },
  );
  if (ok(bid, 'place_bid')) bidsPlaced.add(1);

  sleep(Math.random() * 3 + 1);
}

// ── Scenario D: Full happy-path flow ──────────────────────────────────────────
export function scenarioFullFlow() {
  const client = randomClient();
  const driver = randomDriver();
  const cH = HEADERS(client.accessToken);
  const dH = HEADERS(driver.accessToken);

  // 1. Client creates request
  const create = http.post(
    `${BASE}/api/requests`,
    JSON.stringify(randomRequest()),
    { headers: cH },
  );
  if (!ok(create, 'ff_create_request')) return;
  requestCreated.add(1);
  const requestId = JSON.parse(create.body)?.data?.id;
  if (!requestId) return;

  sleep(0.5);

  // 2. Driver places bid
  const bid = http.post(
    `${BASE}/api/bids`,
    JSON.stringify({ request_id: requestId, amount: 50, note: 'full-flow test' }),
    { headers: dH },
  );
  if (!ok(bid, 'ff_place_bid')) return;
  bidsPlaced.add(1);
  const bidId = JSON.parse(bid.body)?.data?.id;
  if (!bidId) return;

  sleep(0.5);

  // 3. Client accepts bid (creates booking)
  const accept = http.post(
    `${BASE}/api/bids/${bidId}/accept`,
    null,
    { headers: cH },
  );
  if (!ok(accept, 'ff_accept_bid')) return;
  bidsAccepted.add(1);

  // Get the resulting booking
  const bookingList = http.get(`${BASE}/api/bookings`, { headers: dH });
  ok(bookingList, 'ff_list_bookings');
  const bookings = JSON.parse(bookingList.body)?.data ?? [];
  const booking = bookings.find((b) => b.request_id === requestId);
  if (!booking) return;

  sleep(0.5);

  // 4. Driver starts booking
  const start = http.patch(
    `${BASE}/api/bookings/${booking.id}/start`,
    null,
    { headers: dH },
  );
  if (!ok(start, 'ff_start_booking')) return;
  bookingsStarted.add(1);

  sleep(0.5);

  // 5. Driver delivers
  const deliver = http.patch(
    `${BASE}/api/bookings/${booking.id}/deliver`,
    null,
    { headers: dH },
  );
  if (!ok(deliver, 'ff_deliver_booking')) return;
  bookingsDelivered.add(1);

  sleep(1);
}

// Default export (used if no --exec flag — runs all scenarios via options above)
export default function () {}
