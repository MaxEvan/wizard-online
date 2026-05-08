import mysql from "mysql2/promise";

type ParsedDatabaseConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export async function createDatabasePool(databaseUrl: string): Promise<mysql.Pool> {
  const config = parseDatabaseUrl(databaseUrl);

  const bootstrap = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
  });

  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await bootstrap.end();

  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: 10,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      code VARCHAR(12) PRIMARY KEY,
      host_player_id VARCHAR(64) NOT NULL,
      status VARCHAR(16) NOT NULL,
      state_json LONGTEXT NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL
    )
  `);

  return pool;
}

function parseDatabaseUrl(databaseUrl: string): ParsedDatabaseConfig {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }

  if (parsed.protocol !== "mysql:" && parsed.protocol !== "mysqls:") {
    throw new Error("DATABASE_URL must use the mysql:// or mysqls:// protocol.");
  }

  const database = parsed.pathname.replace(/^\/+/, "");
  if (!database) {
    throw new Error("DATABASE_URL must include a database name in the path.");
  }

  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
}
