# Prisma Studio Setup & Fix Commands

This document outlines the steps and commands used to resolve the issue where Prisma Studio was empty, and `npx prisma db pull` was failing to recognize tables due to missing Primary Keys.

## 1. Fix Configuration Variables
Make sure your Prisma configuration targets the correct database environment variables:

- **`schema.prisma`**: Point your datasource to the local database URL and ensure you use the `prisma-client-js` provider.
- **`prisma.config.ts`**: If using a custom config file, make sure the `datasource.url` uses `env("LOCAL_DATABASE_URL")` rather than a fallback or serverless URL.

## 2. Apply Missing Primary Keys
Prisma requires every model to have a unique valid identifier. If your tables were created without a `PRIMARY KEY`, Prisma Client will mark them with `@@ignore` during introspection. We wrote and executed a small node script (`apply_pkeys.js`) that fired standard `ALTER TABLE ... ADD CONSTRAINT` SQL commands directly to the Postgres database.

*(Command to run that specific script if you ever need to set it up fresh)*
```bash
node apply_pkeys.js
```

## 3. Pull the Database Schema
Once the primary keys exist in your database, pull the structure into your `schema.prisma` file so Prisma can officially map your databases to application models:

```bash
npx prisma db pull
```
*(This should introspect and identify all 13 of your tables successfully without issuing warnings about ignored tables).*

## 4. Generate the Prisma Client
After pulling the updated schema, regenerate the actual `@prisma/client` code used within your application logic:

```bash
npx prisma generate
```

## 5. Launch Prisma Studio
Finally, you can launch the Prisma Studio GUI to view, edit, and explore your data:

```bash
npx prisma studio
```
*Note: This usually defaults to `http://localhost:5555`. Open that URL in your browser to view your data.*
