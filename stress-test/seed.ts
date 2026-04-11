/**
 * Deligo stress-test seed script
 *
 * What it does:
 *   1. Connects directly to PostgreSQL
 *   2. Inserts N client users + M driver users (approved)
 *   3. For each user, writes a known OTP hash into otp_tokens
 *   4. Calls POST /api/auth/otp/verify to exchange the OTP for real JWTs
 *   5. Writes tokens.json — consumed by k6 scripts
 *
 * Run:  npx ts-node stress-test/seed.ts
 */

import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

const API = 'http://localhost:3000';
const KNOWN_OTP = '999999';
const NUM_CLIENTS = 20;
const NUM_DRIVERS = 10;

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'deligo',
  password: 'deligo123',
  database: 'deligo',
});

async function clearStaleTestData(client: import('pg').PoolClient) {
  // Remove users whose phone starts with +2160000 (our test range)
  const { rows: users } = await client.query(
    `SELECT id FROM users WHERE phone LIKE '+2160000%'`,
  );
  if (users.length > 0) {
    const ids = users.map((u) => u.id);
    await client.query(`DELETE FROM otp_tokens WHERE phone LIKE '+2160000%'`);
    await client.query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM notifications WHERE user_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM ratings WHERE rated_by_id = ANY($1) OR rated_user_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM tracking_events WHERE booking_id IN (
      SELECT id FROM bookings WHERE client_id = ANY($1) OR driver_id = ANY($1))`, [ids]);
    await client.query(`DELETE FROM bookings WHERE client_id = ANY($1) OR driver_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM bids WHERE driver_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM transport_requests WHERE client_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM driver_h3_presence WHERE driver_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM driver_profiles WHERE user_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
  }
  console.log(`Cleared ${users.length} stale test users`);
}

async function seedUser(
  client: import('pg').PoolClient,
  phone: string,
  role: 'CLIENT' | 'DRIVER',
): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO users (phone, role) VALUES ($1, $2) RETURNING id`,
    [phone, role],
  );
  return rows[0].id as string;
}

async function seedOtp(
  client: import('pg').PoolClient,
  phone: string,
): Promise<void> {
  const hash = await bcrypt.hash(KNOWN_OTP, 10);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min
  await client.query(`DELETE FROM otp_tokens WHERE phone = $1`, [phone]);
  await client.query(
    `INSERT INTO otp_tokens (phone, code_hash, expires_at) VALUES ($1, $2, $3)`,
    [phone, hash, expiresAt],
  );
}

async function verifyOtp(phone: string): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await fetch(`${API}/api/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: KNOWN_OTP }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OTP verify failed for ${phone}: ${res.status} ${body}`);
  }
  const body = (await res.json()) as { data: { accessToken: string; refreshToken: string } };
  return { accessToken: body.data.accessToken, refreshToken: body.data.refreshToken };
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('Clearing stale test data...');
    await clearStaleTestData(client);

    const clientPhones: string[] = [];
    const driverPhones: string[] = [];

    for (let i = 0; i < NUM_CLIENTS; i++) {
      clientPhones.push(`+216000011${String(i).padStart(2, '0')}`);
    }
    for (let i = 0; i < NUM_DRIVERS; i++) {
      driverPhones.push(`+216000022${String(i).padStart(2, '0')}`);
    }

    console.log(`Seeding ${NUM_CLIENTS} clients...`);
    const clientIds: string[] = [];
    for (const phone of clientPhones) {
      const id = await seedUser(client, phone, 'CLIENT');
      clientIds.push(id);
      await seedOtp(client, phone);
    }

    console.log(`Seeding ${NUM_DRIVERS} drivers (approved)...`);
    const driverIds: string[] = [];
    for (const phone of driverPhones) {
      const id = await seedUser(client, phone, 'DRIVER');
      driverIds.push(id);
      // Create approved driver profile
      await client.query(
        `INSERT INTO driver_profiles
          (user_id, application_status, vehicle_type, plate_number, capacity_kg)
         VALUES ($1, 'APPROVED', 'Compact Van', $2, 500)`,
        [id, `TEST-${id.substring(0, 6)}`],
      );
      await seedOtp(client, phone);
    }

    console.log('Exchanging OTPs for JWT tokens...');
    const clientTokens: { phone: string; accessToken: string; refreshToken: string }[] = [];
    const driverTokens: { phone: string; accessToken: string; refreshToken: string }[] = [];

    for (const phone of clientPhones) {
      const tokens = await verifyOtp(phone);
      clientTokens.push({ phone, ...tokens });
      process.stdout.write('.');
    }
    console.log();

    for (const phone of driverPhones) {
      const tokens = await verifyOtp(phone);
      driverTokens.push({ phone, ...tokens });
      process.stdout.write('.');
    }
    console.log();

    const output = { clientTokens, driverTokens };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodePath = require('path') as typeof import('path');
    fs.writeFileSync(
      nodePath.join(__dirname, 'tokens.json'),
      JSON.stringify(output, null, 2),
    );

    console.log(`\nDone. tokens.json written.`);
    console.log(`  ${clientTokens.length} client tokens`);
    console.log(`  ${driverTokens.length} driver tokens`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
