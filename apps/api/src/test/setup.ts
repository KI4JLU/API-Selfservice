// Runs in every worker before the test file is imported. Guards the schema so that a
// misconfigured run can never touch the dev schema.
process.env.DB_SCHEMA = 'api_selfservice_test';
process.env.NODE_ENV = 'test';
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgres://api_selfservice:api_selfservice@localhost:5433/litellm';
