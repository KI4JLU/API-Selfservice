// Runs in every worker before the test file is imported. Guards the schema so that a
// misconfigured run can never touch the dev schema.
process.env.DB_SCHEMA = 'litelite_test';
process.env.NODE_ENV = 'test';
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgres://litelite:litelite@localhost:5433/litellm';
