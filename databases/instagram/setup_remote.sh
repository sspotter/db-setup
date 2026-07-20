#!/bin/bash

# setup_remote.sh - One-click setup for the backend on a new server

echo "===================================================="
echo "   Insta Surfer Remote Backend Setup Script"
echo "===================================================="

# 1. Check for Node.js
if ! command -v node &> /dev/null
then
    echo "ERROR: Node.js is not installed. Please install Node.js first."
    exit 1
fi

# 2. Setup .env file
if [ ! -f .env ]; then
    echo "No .env file found. Creating one..."
    read -p "Enter your Remote PostgreSQL URL (e.g., postgresql://user:pass@host:port/dbname): " db_url
    echo "DATABASE_URL=\"$db_url\"" > .env
    echo "LOCAL_DATABASE_URL=\"$db_url\"" >> .env
    echo "PORT=8442" >> .env
    echo "JWT_SECRET=\"$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")\"" >> .env
    echo ".env file created."
else
    echo ".env file already exists. Using existing configuration."
fi

# 3. Install Dependencies
echo "Installing dependencies..."
npm install

# 4. Initialize Database
echo "Initializing database from schema..."
node deploy_init.js

# 5. Prisma Sync
echo "Syncing Prisma schema..."
npx prisma db pull

echo "Generating Prisma client..."
npx prisma generate

echo "===================================================="
echo "   Setup Finished Successfully!"
echo "===================================================="
echo "You can now start the server with: npm start"
echo "===================================================="
