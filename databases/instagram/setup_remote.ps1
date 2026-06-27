# setup_remote.ps1 - One-click setup for the backend on a new Windows server

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "   Insta Surfer Remote Backend Setup Script (Windows)" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# 1. Check for Node.js
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not installed. Please install Node.js first."
    exit
}

# 2. Setup .env file
if (!(Test-Path .env)) {
    Write-Host "No .env file found. Creating one..."
    $db_url = Read-Host "Enter your Remote PostgreSQL URL (e.g., postgresql://user:pass@host:port/dbname)"
    $jwt_secret = [Guid]::NewGuid().ToString("N")
    
    "DATABASE_URL=`"$db_url`"" | Out-File -FilePath .env -Encoding utf8
    "LOCAL_DATABASE_URL=`"$db_url`"" | Out-File -FilePath .env -Encoding utf8 -Append
    "PORT=3001" | Out-File -FilePath .env -Encoding utf8 -Append
    "JWT_SECRET=`"$jwt_secret`"" | Out-File -FilePath .env -Encoding utf8 -Append
    
    Write-Host ".env file created."
} else {
    Write-Host ".env file already exists. Using existing configuration."
}

# 3. Install Dependencies
Write-Host "Installing dependencies..."
npm install

# 4. Initialize Database
Write-Host "Initializing database from schema..."
node deploy_init.js

# 5. Prisma Sync
Write-Host "Syncing Prisma schema..."
npx prisma db pull

Write-Host "Generating Prisma client..."
npx prisma generate

Write-Host "====================================================" -ForegroundColor Green
Write-Host "   Setup Finished Successfully!" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
Write-Host "You can now start the server with: npm start"
Write-Host "===================================================="
