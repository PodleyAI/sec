import { describe, expect, it } from "bun:test";
import { buildEnvConfig } from "./init";
import type { InitConfig } from "./init";

describe("buildEnvConfig", () => {
  it("generates SQLite config with required vars", () => {
    const config: InitConfig = {
      dbType: "sqlite",
      dbFolder: "/home/user/.sec/data",
      dbName: "edgar",
      rawDataFolder: "/home/user/.sec/raw",
    };
    const result = buildEnvConfig(config);
    expect(result).toContain('SEC_DB_TYPE="sqlite"');
    expect(result).toContain('SEC_DB_FOLDER="/home/user/.sec/data"');
    expect(result).toContain('SEC_DB_NAME="edgar"');
    expect(result).toContain('SEC_RAW_DATA_FOLDER="/home/user/.sec/raw"');
    expect(result).not.toContain("SEC_PG_");
  });

  it("generates Postgres config with URL when pgUrl provided", () => {
    const config: InitConfig = {
      dbType: "postgres",
      dbFolder: "/home/user/.sec/data",
      dbName: "edgar",
      rawDataFolder: "/home/user/.sec/raw",
      pgUrl: "postgres://user:pass@localhost:5432/edgar",
    };
    const result = buildEnvConfig(config);
    expect(result).toContain('SEC_DB_TYPE="postgres"');
    expect(result).toContain('SEC_PG_URL="postgres://user:pass@localhost:5432/edgar"');
    expect(result).not.toContain("SEC_PG_HOST");
    expect(result).not.toContain("SEC_PG_PORT");
    expect(result).not.toContain("SEC_PG_USER");
    expect(result).not.toContain("SEC_PG_PASSWORD");
    expect(result).not.toContain("SEC_PG_DATABASE");
  });

  it("generates Postgres config with individual params when no pgUrl", () => {
    const config: InitConfig = {
      dbType: "postgres",
      dbFolder: "/home/user/.sec/data",
      dbName: "edgar",
      rawDataFolder: "/home/user/.sec/raw",
      pgHost: "db.example.com",
      pgPort: "5433",
      pgUser: "admin",
      pgPassword: "secret",
      pgDatabase: "sec_data",
    };
    const result = buildEnvConfig(config);
    expect(result).toContain('SEC_DB_TYPE="postgres"');
    expect(result).toContain('SEC_PG_HOST="db.example.com"');
    expect(result).toContain('SEC_PG_PORT="5433"');
    expect(result).toContain('SEC_PG_USER="admin"');
    expect(result).toContain('SEC_PG_PASSWORD="secret"');
    expect(result).toContain('SEC_PG_DATABASE="sec_data"');
    expect(result).not.toContain("SEC_PG_URL");
  });

  it("escapes double quotes in values", () => {
    const config: InitConfig = {
      dbType: "sqlite",
      dbFolder: '/path/with/"quotes"',
      dbName: 'name"with"quotes',
      rawDataFolder: "/simple/path",
    };
    const result = buildEnvConfig(config);
    expect(result).toContain('SEC_DB_FOLDER="/path/with/\\"quotes\\""');
    expect(result).toContain('SEC_DB_NAME="name\\"with\\"quotes"');
  });

  it("escapes newlines in values", () => {
    const config: InitConfig = {
      dbType: "postgres",
      dbFolder: "/path",
      dbName: "edgar",
      rawDataFolder: "/raw",
      pgPassword: "pass\nword",
    };
    const result = buildEnvConfig(config);
    expect(result).toContain('SEC_PG_PASSWORD="pass\\nword"');
  });
});
