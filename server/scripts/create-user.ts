/**
 * Creates a user directly against the database, or updates the password of an
 * existing one. There is no signup endpoint - accounts are created by hand
 * for a small closed group.
 *
 * Usage: npm run create-user -- email password "Display Name"
 */
import { db, migrate, nowIso } from '../db.js'
import { hashPassword } from '../lib/auth.js'

async function main(): Promise<void> {
  const [email, password, name] = process.argv.slice(2)
  if (!email || !password) {
    console.error('Usage: npm run create-user -- email password "Display Name"')
    process.exitCode = 1
    return
  }

  await migrate()

  const passwordHash = await hashPassword(password)
  const existing = await db.get<{ id: number }>('SELECT id FROM users WHERE email = ?', email.toLowerCase())

  let userId: number
  if (existing) {
    await db.run('UPDATE users SET password_hash = ?, name = ? WHERE id = ?', passwordHash, name ?? null, existing.id)
    userId = existing.id
    console.log(`Updated password for ${email} (id ${userId}).`)
  } else {
    const info = await db.run(
      'INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?) RETURNING id',
      email.toLowerCase(),
      passwordHash,
      name ?? null,
      nowIso(),
    )
    userId = info.lastInsertRowid as number
    console.log(`Created ${email} (id ${userId}).`)
  }

  await db.run(
    'INSERT INTO profile (user_id, weekly_hours_target, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO NOTHING',
    userId,
    5,
    nowIso(),
  )

  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
