/**
 * CLI seed script for provisioning the first admin user.
 *
 * Usage:
 *   npm run seed:admin -- --name "Admin" --email admin@example.com --password "s3cure-pass"
 *
 * Refuses to run in production unless --force is passed. This replaces the old
 * unauthenticated `/api/auth/seed-admin` HTTP endpoint (a critical security
 * issue: anyone could create an account).
 */
import { parseArgs } from 'node:util';
import bcrypt from 'bcryptjs';
import sequelize from '../src/config/db.js';
import '../src/models/User.js';
import User from '../src/models/User.js';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
});

const required = ['name', 'email', 'password'];
const missing = required.filter((k) => !values[k]);

if (missing.length > 0) {
  console.error(`Missing required option(s): ${missing.join(', ')}`);
  console.error('Usage: npm run seed:admin -- --name <name> --email <email> --password <password>');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production' && !values.force) {
  console.error(
    'Refusing to seed an admin in production. Pass --force only if you are certain.'
  );
  process.exit(1);
}

if (String(values.password).length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

try {
  await sequelize.sync();

  const existing = await User.findOne({ where: { email: values.email } });
  if (existing) {
    console.log(`Admin with email ${values.email} already exists — nothing to do.`);
    await sequelize.close();
    process.exit(0);
  }

  const hashed = await bcrypt.hash(values.password, 10);
  const user = await User.create({
    name: values.name,
    email: values.email,
    password: hashed,
  });

  console.log(`✅ Admin created: ${user.name} <${user.email}> (id=${user.id})`);
  await sequelize.close();
} catch (err) {
  console.error('Failed to seed admin:', err.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
}
